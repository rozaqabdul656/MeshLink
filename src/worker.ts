import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { TaskHandler } from "./node.js";

export type WorkerCommand = { command: string; args?: string[]; readOnly?: boolean };
export type WorkerProfile = { name: string; workdir: string; timeoutSeconds?: number; maxOutputBytes?: number; commands: Record<string, WorkerCommand> };

export function loadWorkerProfile(filePath: string): WorkerProfile {
  const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as Partial<WorkerProfile>;
  const workdir = parsed?.workdir;
  if (!parsed || typeof parsed.name !== "string" || typeof workdir !== "string" || !path.isAbsolute(workdir) || !parsed.commands || typeof parsed.commands !== "object") throw new Error("Worker profile requires name, absolute workdir, and commands");
  if (!fs.statSync(workdir).isDirectory()) throw new Error("Worker profile workdir must be an existing directory");
  for (const [capability, command] of Object.entries(parsed.commands)) {
    if (!capability || !command || typeof command.command !== "string" || !command.command || (command.args !== undefined && (!Array.isArray(command.args) || !command.args.every((arg) => typeof arg === "string")))) throw new Error(`Invalid worker command for ${capability}`);
  }
  return parsed as WorkerProfile;
}

/**
 * A constrained adapter: a network task selects a named capability only.
 * It cannot supply a shell string, executable, arguments, or working directory.
 */
export function createSandboxedWorker(profile: WorkerProfile): { capabilities: string[]; handler(capability: string): TaskHandler } {
  const timeoutMs = Math.min(3_600_000, Math.max(1_000, (profile.timeoutSeconds ?? 600) * 1000));
  const maxOutputBytes = Math.min(1_048_576, Math.max(1_024, profile.maxOutputBytes ?? 200 * 1024));
  const capabilities = Object.keys(profile.commands);
  return {
    capabilities,
    handler(capability) {
      const definition = profile.commands[capability];
      if (!definition) throw new Error(`Worker capability is not configured: ${capability}`);
      return async (request) => {
        if ("command" in request.input || "args" in request.input || "cwd" in request.input) throw new Error("RAW_COMMAND_INPUT_FORBIDDEN");
        if (request.constraints?.readOnly && definition.readOnly === false) throw new Error("READ_ONLY_CONSTRAINT_FORBIDS_CAPABILITY");
        const output = await run(definition, profile.workdir, timeoutMs, maxOutputBytes);
        return { summary: `${profile.name} completed ${capability}`, evidence: output ? [output] : [] };
      };
    },
  };
}

function run(definition: WorkerCommand, workdir: string, timeoutMs: number, maxOutputBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(definition.command, definition.args ?? [], { cwd: workdir, shell: false, windowsHide: true, env: { PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let exceeded = false;
    const append = (chunk: Buffer) => { if (exceeded) return; output += chunk.toString("utf8"); if (Buffer.byteLength(output) > maxOutputBytes) { exceeded = true; child.kill("SIGTERM"); } };
    child.stdout.on("data", append); child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (exceeded) return reject(new Error("WORKER_OUTPUT_LIMIT_EXCEEDED"));
      if (signal) return reject(new Error("WORKER_TIMEOUT"));
      if (code !== 0) return reject(new Error(`WORKER_EXIT_${code}`));
      resolve(output.trim());
    });
  });
}
