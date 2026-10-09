const $ = (selector) => document.querySelector(selector);
const empty = () => $("#empty").content.cloneNode(true);
const formatTime = (time) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(time));

function statusClass(status) { return `status ${status.replaceAll("_", "-")}`; }

function renderTopology(agent) {
  $("#topology").innerHTML = `
    <div class="route source"><span class="node-icon">✦</span><b>MCP host</b><small>Codex · Claude · Gemini</small></div>
    <span class="line line-one">MCP</span>
    <div class="route adapter"><span class="node-icon">↔</span><b>MeshLink adapter</b><small>Tool boundary</small></div>
    <span class="line line-two">v1 task</span>
    <div class="route node"><span class="node-icon">⌘</span><b>${agent?.name ?? "MeshLink Node"}</b><small>Policy + task router</small></div>
    <div class="route policy"><span class="node-icon">◈</span><b>Local policy</b><small>Deny by default</small></div>
    <div class="route handler"><span class="node-icon">▣</span><b>Capability handler</b><small>${agent?.capabilities?.join(" · ") ?? "No capability"}</small></div>`;
}

function renderAgents(agents) {
  const host = $("#agents"); host.replaceChildren();
  if (!agents.length) return host.append(empty());
  agents.forEach((agent) => {
    const item = document.createElement("article"); item.className = "agent";
    item.innerHTML = `<div><span class="agent-avatar">${agent.name.slice(0, 1).toUpperCase()}</span><div><b>${agent.name}</b><small>${agent.endpoint}</small></div></div><span class="availability"><i></i>${agent.status}</span><p>${agent.capabilities.map((value) => `<code>${value}</code>`).join("")}</p>`;
    host.append(item);
  });
}

function renderTasks(tasks) {
  const host = $("#tasks"); host.replaceChildren();
  if (!tasks.length) return host.append(empty());
  tasks.slice(0, 6).forEach((task) => {
    const item = document.createElement("article"); item.className = "task";
    item.innerHTML = `<div><div><b>${task.request.targetCapability}</b><small>${task.request.caller} · ${formatTime(task.updatedAt)}</small></div><span class="${statusClass(task.status)}">${task.status.replaceAll("_", " ")}</span></div><p>${task.result?.summary ?? task.error?.message ?? task.request.input.instruction ?? "Waiting for execution"}</p>`;
    host.append(item);
  });
}

function renderAudit(events) {
  const host = $("#audit"); host.replaceChildren();
  if (!events.length) return host.append(empty());
  events.slice().reverse().slice(0, 7).forEach((event) => {
    const item = document.createElement("li");
    item.innerHTML = `<span class="audit-dot ${event.action}"></span><div><b>${event.action.replaceAll("_", " ")}</b><small>${event.caller} → ${event.capability}</small></div><time>${formatTime(event.at)}</time>`;
    host.append(item);
  });
}

async function refresh() {
  const button = $("#refresh"); button.disabled = true;
  try {
    const [health, agentResponse, taskResponse, auditResponse] = await Promise.all([
      fetch("/health"), fetch("/v1/agents"), fetch("/v1/tasks"), fetch("/v1/audit"),
    ]);
    if (!health.ok) throw new Error("Node unavailable");
    const [{ agents }, { tasks }, { events }] = await Promise.all([agentResponse.json(), taskResponse.json(), auditResponse.json()]);
    $("#connection").textContent = "Node online"; $("#connection-dot").classList.add("online");
    $("#agent-count").textContent = agents.length; $("#task-count").textContent = tasks.length;
    $("#approval-count").textContent = tasks.filter((task) => task.status === "awaiting_approval").length;
    renderTopology(agents[0]); renderAgents(agents); renderTasks(tasks); renderAudit(events);
  } catch (error) {
    $("#connection").textContent = "Node offline"; $("#connection-dot").classList.remove("online");
  } finally { button.disabled = false; }
}

$("#refresh").addEventListener("click", refresh);
refresh();
