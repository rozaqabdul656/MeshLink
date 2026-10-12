import { createApi } from "./router.js";

const $ = (selector) => document.querySelector(selector);
const api = createApi();
const empty = () => $("#empty").content.cloneNode(true);
const text = (value) => document.createTextNode(String(value ?? ""));
let taskFilter = "all";

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
function statusClass(status) { return `status ${String(status).replaceAll("_", "-")}`; }
function route(className, title, subtitle) {
  const item = document.createElement("div"); item.className = `route ${className}`;
  const strong = document.createElement("b"); strong.append(text(title));
  const small = document.createElement("small"); small.append(text(subtitle));
  item.append(strong, small); return item;
}
function renderTopology(node, agents) {
  const host = $("#topology"); host.replaceChildren(
    route("source", "MCP hosts", `${agents.length} discoverable node${agents.length === 1 ? "" : "s"}`),
    route("adapter", "MeshLink adapter", "MCP → task envelope"),
    route("node", node?.name ?? "Local node", node?.endpoint ?? "Waiting for node"),
    route("policy", "Local policy", "deny by default"),
    route("handler", "Capability handler", `${node?.capabilities?.length ?? 0} declared capability`),
  );
  ["line line-one", "line line-two"].forEach((className) => { const line = document.createElement("div"); line.className = className; host.append(line); });
}
function renderAgents(agents, localId) {
  const host = $("#agents"); host.replaceChildren();
  if (!agents.length) return host.append(empty());
  agents.forEach((agent) => {
    const item = document.createElement("article"); item.className = "agent";
    const heading = document.createElement("div");
    const avatar = document.createElement("span"); avatar.className = "agent-avatar"; avatar.append(text(agent.name.slice(0, 1).toUpperCase()));
    const copy = document.createElement("div"); const name = document.createElement("b"); name.append(text(agent.name));
    const endpoint = document.createElement("small"); endpoint.append(text(agent.id === localId ? `${agent.endpoint} · this node` : agent.endpoint));
    copy.append(name, endpoint); heading.append(avatar, copy);
    const availability = document.createElement("span"); availability.className = "availability"; availability.append(text(agent.status));
    const capabilities = document.createElement("p"); agent.capabilities.forEach((capability) => { const code = document.createElement("code"); code.append(text(capability)); capabilities.append(code); });
    item.append(heading, availability, capabilities); host.append(item);
  });
}
function renderTasks(tasks) {
  const host = $("#tasks"); host.replaceChildren();
  const filtered = taskFilter === "all" ? tasks : tasks.filter((task) => task.status === taskFilter);
  if (!filtered.length) return host.append(empty());
  filtered.slice(0, 6).forEach((task) => {
    const item = document.createElement("article"); item.className = "task";
    const heading = document.createElement("div"); const copy = document.createElement("div");
    const capability = document.createElement("b"); capability.append(text(task.request.targetCapability));
    const caller = document.createElement("small"); caller.append(text(`${task.request.caller} · ${formatTime(task.updatedAt)}`)); copy.append(capability, caller);
    const status = document.createElement("span"); status.className = statusClass(task.status); status.append(text(task.status)); heading.append(copy, status);
    const detail = document.createElement("p"); detail.append(text(task.result?.summary ?? task.error?.message ?? task.request.input.instruction ?? "Waiting for execution")); item.append(heading, detail); host.append(item);
  });
}
function renderAudit(events) {
  const host = $("#audit"); host.replaceChildren(); if (!events.length) return host.append(empty());
  events.slice().reverse().slice(0, 7).forEach((event) => {
    const item = document.createElement("li"); const dot = document.createElement("span"); dot.className = `audit-dot ${event.action}`;
    const copy = document.createElement("div"); const action = document.createElement("b"); action.append(text(event.action.replaceAll("_", " "));
    const detail = document.createElement("small"); detail.append(text(`${event.caller} → ${event.capability}`)); copy.append(action, detail);
    const time = document.createElement("time"); time.append(text(formatTime(event.at))); item.append(dot, copy, time); host.append(item);
  });
}
async function refresh() {
  const button = $("#refresh"); button.disabled = true;
  try {
    const [health, nodeResponse, agentResponse, taskResponse, auditResponse] = await Promise.all([api("/health"), api("/dashboard/api/node"), api("/dashboard/api/agents"), api("/dashboard/api/tasks"), api("/dashboard/api/audit")]);
    if (!health.ok) throw new Error("Node unavailable");
    const [{ node }, { agents }, { tasks }, { events }] = await Promise.all([nodeResponse.json(), agentResponse.json(), taskResponse.json(), auditResponse.json()]);
    $("#connection").textContent = "Node online"; $("#connection-dot").classList.add("online");
    $("#agent-count").textContent = agents.filter((agent) => agent.status === "available").length;
    $("#task-count").textContent = tasks.length; $("#approval-count").textContent = tasks.filter((task) => task.status === "awaiting_approval").length;
    renderTopology(node, agents); renderAgents(agents, node.id); renderTasks(tasks); renderAudit(events);
  } catch (error) {
    if (error?.message !== "DASHBOARD_AUTH_REQUIRED") { $("#connection").textContent = "Node offline"; $("#connection-dot").classList.remove("online"); }
  } finally { button.disabled = false; }
}
$("#refresh").addEventListener("click", refresh);
$("#task-filter").addEventListener("click", () => { taskFilter = taskFilter === "all" ? "awaiting_approval" : "all"; $("#task-filter").textContent = taskFilter === "all" ? "All status" : "Approval only"; refresh(); });
refresh();
