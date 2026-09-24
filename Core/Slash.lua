local _, ns = ...

local L = ns.L
local DB = ns.DB
local Diagnostics = ns.Diagnostics

local Slash = {}
ns.Slash = Slash

local TUNE_FIELDS = { size = true, x = true, y = true }

local function Help()
	for _, line in ipairs(L.SLASH_HELP) do
		ns:Print(line)
	end
end

local function Check(argument)
	local questID = tonumber(argument)
	if not questID then
		ns:Print(L.SLASH_CHECK_USAGE)
		return
	end
	Diagnostics.PrintCheck(questID)
end

local function ToggleDebug()
	local enabled = not DB.GetSetting("debug")
	DB.SetSetting("debug", enabled)
	ns:Print(L.SLASH_DEBUG:format(enabled and L.SLASH_ON or L.SLASH_OFF))
end

local function Tune(argument)
	local contexts = {}
	for context in pairs(ns.Badge.DEFAULT_LAYOUT) do
		table.insert(contexts, context)
	end
	table.sort(contexts)

	if argument == "reset" then
		ns.db.layout = {}
		ns.Integrations.RefreshAll()
		ns:Print(L.SLASH_TUNE_RESET)
		return
	end
	local context, field, value = argument:match("^(%S+)%s+(%S+)%s+(%S+)$")
	value = tonumber(value)
	-- Sizes and offsets end up in %d format strings; keep them whole.
	value = value and math.floor(value + 0.5)
	if not (context and ns.Badge.DEFAULT_LAYOUT[context] and TUNE_FIELDS[field] and value) then
		ns:Print(L.SLASH_TUNE_USAGE:format(table.concat(contexts, ", ")))
		return
	end
	ns.db.layout[context] = ns.db.layout[context] or {}
	ns.db.layout[context][field] = value
	ns.Integrations.RefreshAll()
	ns:Print(L.SLASH_TUNE_DONE:format(context, field, value))
end

local function Reset(argument)
	if argument == "recorder confirm" then
		ns:Print(L.SLASH_RESET_DONE:format(ns.Recorder.Reset()))
	elseif argument == "recorder" then
		ns:Print(L.SLASH_RESET_CONFIRM:format(ns.Recorder.Count()))
	else
		Help()
	end
end

local COMMANDS = {
	[""] = function()
		ns.OpenOptions()
	end,
	options = function()
		ns.OpenOptions()
	end,
	help = Help,
	check = Check,
	id = Check,
	export = function(argument)
		ns.ShowExport(argument)
	end,
	status = Diagnostics.PrintStatus,
	probe = Diagnostics.PrintProbe,
	errors = Diagnostics.PrintErrors,
	debug = ToggleDebug,
	tune = Tune,
	reset = Reset,
}

function Slash.Run(input)
	local command, argument = (input or ""):match("^%s*(%S*)%s*(.-)%s*$")
	command = command:lower()
	local handler = COMMANDS[command]
	if not handler then
		ns:Print(L.SLASH_UNKNOWN:format(command))
		return
	end
	handler(argument)
end

function Slash.Register()
	SLASH_FOREVERQUESTMARKER1 = "/fqm"
	SLASH_FOREVERQUESTMARKER2 = "/foreverquest"
	SlashCmdList.FOREVERQUESTMARKER = function(input)
		ns.SafeCall("slash command", Slash.Run, input)
	end
end
