local _, ns = ...

-- Each UI integration (quest window, gossip, quest log, ...) registers here. It is
-- installed once its Blizzard addon is loaded, and every install or refresh runs
-- through SafeCall, so one broken integration cannot take the others down.

local Integrations = {}
ns.Integrations = Integrations

Integrations.Status = {
	PENDING = "pending",
	INSTALLED = "installed",
	UNAVAILABLE = "unavailable",
	FAILED = "failed",
}
local Status = Integrations.Status

local registry = {}

--- spec = { key, label, loadsWith = optional Blizzard addon name,
---          Install = function() -> installed, detail, Refresh = optional function }
function Integrations.Register(spec)
	spec.status = Status.PENDING
	table.insert(registry, spec)
end

local function IsAddOnLoaded(name)
	local loaded = C_AddOns.IsAddOnLoaded(name)
	return loaded
end

local function TryInstall(spec)
	if spec.status ~= Status.PENDING then
		return
	end
	local ok = ns.SafeCall("install " .. spec.key, function()
		local installed, detail = spec.Install()
		spec.status = installed and Status.INSTALLED or Status.UNAVAILABLE
		spec.detail = detail
	end)
	if not ok then
		spec.status = Status.FAILED
	end
	ns:Debug(spec.key, spec.status, spec.detail or "")
end

function Integrations.InstallAll()
	for _, spec in ipairs(registry) do
		if not spec.loadsWith or IsAddOnLoaded(spec.loadsWith) then
			TryInstall(spec)
		end
	end
end

--- Installs integrations that were waiting for a load-on-demand Blizzard addon.
function Integrations.OnAddOnLoaded(addonName)
	for _, spec in ipairs(registry) do
		if spec.loadsWith == addonName then
			TryInstall(spec)
		end
	end
end

--- Re-applies markers on visible frames, for example after a setting changed.
function Integrations.RefreshAll()
	for _, spec in ipairs(registry) do
		if spec.status == Status.INSTALLED and spec.Refresh then
			ns.SafeCall("refresh " .. spec.key, spec.Refresh)
		end
	end
end

function Integrations.List()
	return registry
end
