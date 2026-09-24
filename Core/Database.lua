local _, ns = ...

local DB = {}
ns.DB = DB

local SCHEMA_VERSION = 1

DB.DEFAULT_SETTINGS = {
	enabled = true,
	markQuestFrame = true,
	markGossip = true,
	markQuestLog = true,
	markTracker = true,
	tooltips = true,
	showInferred = true,
	distinguishInferred = true,
	showChanged = true,
	showSoD = true,
	textTags = false,
	recorder = true,
	recordClassic = true,
	chatFallback = true,
	chatAnnounce = false,
	debug = false,
}

local function NewClientId()
	-- Random and stable per installation; lets the pipeline count independent
	-- reporters without identifying anyone.
	return ("%08x%08x"):format(math.random(0, 0x7fffffff), math.random(0, 0x7fffffff))
end

--- Loads or creates the saved variables. Called once, on ADDON_LOADED.
function DB.Initialize()
	local saved = _G.ForeverQuestMarkerDB
	if type(saved) ~= "table" then
		saved = {}
		_G.ForeverQuestMarkerDB = saved
	end

	saved.schema = saved.schema or SCHEMA_VERSION
	saved.settings = type(saved.settings) == "table" and saved.settings or {}
	for key, value in pairs(DB.DEFAULT_SETTINGS) do
		if type(saved.settings[key]) ~= type(value) then
			saved.settings[key] = value
		end
	end
	saved.layout = type(saved.layout) == "table" and saved.layout or {}
	saved.observations = type(saved.observations) == "table" and saved.observations or {}
	saved.errors = type(saved.errors) == "table" and saved.errors or {}
	if type(saved.clientId) ~= "string" or not saved.clientId:match("^%x+$") or #saved.clientId ~= 16 then
		saved.clientId = NewClientId()
	end

	ns.db = saved
	return saved
end

function DB.GetSetting(key)
	local value = ns.db and ns.db.settings[key]
	if value == nil then
		return DB.DEFAULT_SETTINGS[key]
	end
	return value
end

function DB.SetSetting(key, value)
	ns.db.settings[key] = value
	ns:Fire("SETTING_CHANGED", key, value)
end

