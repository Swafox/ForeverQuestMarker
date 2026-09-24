local _, ns = ...

local State = ns.State

-- Serializes recorded quests in the format described in docs/EXPORT_FORMAT.md.

local Export = {}
ns.Export = Export

Export.FORMAT = "ForeverQuestMarker"
Export.VERSION = 1
-- The submission pipeline's per-export limit (worker/src/validate.ts).
Export.MAX_QUESTS = 5000
-- The community paste page (worker/, docs/PIPELINE.md), shown in the export window.
Export.SUBMIT_URL = "https://forever.swafox.com"

local CONTEXT_ORDER = {
	"detail", "progress", "complete", "gossip", "greeting", "log", "tracker", "accepted", "turnedIn",
}

local STATE_ORDER = {
	[State.CONFIRMED] = 1,
	[State.INFERRED] = 2,
	[State.CHANGED] = 3,
	[State.SOD] = 4,
	[State.ERA] = 5,
	[State.CLASSIC] = 6,
}

local function SortedContexts(contexts)
	local list = {}
	for _, context in ipairs(CONTEXT_ORDER) do
		if contexts[context] then
			table.insert(list, context)
		end
	end
	return list
end

local function IsExportable(record)
	return type(record) == "table" and type(record.id) == "number" and type(record.title) == "string"
		and STATE_ORDER[record.state] ~= nil
end

--- Recorded quests as export records, new quests first, then by ID.
function Export.CollectQuests()
	local quests = {}
	for _, record in pairs(ns.db.observations) do
		if IsExportable(record) then
			table.insert(quests, {
				id = record.id,
				title = record.title,
				state = record.state,
				level = record.level,
				giver = record.giver,
				map = record.map,
				x = record.x,
				y = record.y,
				faction = record.faction,
				contexts = SortedContexts(record.contexts or {}),
				firstSeen = record.firstSeen,
				lastSeen = record.lastSeen,
				seenCount = record.seenCount,
				accepted = record.accepted,
				turnedIn = record.turnedIn,
			})
		end
	end
	table.sort(quests, function(a, b)
		local stateA, stateB = STATE_ORDER[a.state], STATE_ORDER[b.state]
		if stateA ~= stateB then
			return stateA < stateB
		end
		return a.id < b.id
	end)
	-- New quests sort first, so a capped export drops Classic observations.
	for i = #quests, Export.MAX_QUESTS + 1, -1 do
		quests[i] = nil
	end
	return quests
end

function Export.BuildDocument()
	local version, build, _, interface = GetBuildInfo()
	local quests = Export.CollectQuests()
	return {
		format = Export.FORMAT,
		version = Export.VERSION,
		addonVersion = ns:GetVersion(),
		clientId = ns.db.clientId,
		build = ("%s.%s"):format(version, build),
		interface = interface,
		locale = GetLocale(),
		exportedAt = time(),
		count = #quests,
		quests = quests,
	}
end

-- JSON ------------------------------------------------------------------------

local ESCAPES = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\b"] = "\\b",
	["\f"] = "\\f",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function EncodeString(value)
	return '"' .. value:gsub('[%c"\\]', function(ch)
		return ESCAPES[ch] or ("\\u%04x"):format(ch:byte())
	end) .. '"'
end

local function EncodeNumber(value)
	if value ~= value or value == math.huge or value == -math.huge then
		return "null"
	end
	if value == math.floor(value) then
		return ("%d"):format(value)
	end
	return (("%.3f"):format(value):gsub("0+$", ""):gsub("%.$", ""))
end

-- Scalars and arrays of scalars; objects go through EncodeObject.
local function EncodeValue(value)
	local valueType = type(value)
	if valueType == "string" then
		return EncodeString(value)
	elseif valueType == "number" then
		return EncodeNumber(value)
	elseif valueType == "boolean" then
		return value and "true" or "false"
	elseif valueType == "table" then
		local parts = {}
		for i = 1, #value do
			parts[i] = EncodeValue(value[i])
		end
		return "[" .. table.concat(parts, ",") .. "]"
	end
	return "null"
end

-- Nested objects and their key order.
local NESTED_KEYS = {
	giver = { "type", "id", "name" },
}

-- Objects are written with a fixed key order so exports are stable and readable.
local function EncodeObject(object, keys)
	local parts = {}
	for _, key in ipairs(keys) do
		local value = object[key]
		if value ~= nil then
			local nested = NESTED_KEYS[key]
			local encoded = nested and EncodeObject(value, nested) or EncodeValue(value)
			table.insert(parts, EncodeString(key) .. ":" .. encoded)
		end
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

local DOCUMENT_KEYS = {
	"format", "version", "addonVersion", "clientId", "build", "interface", "locale", "exportedAt", "count",
}
local QUEST_KEYS = {
	"id", "title", "state", "level", "giver", "map", "x", "y", "faction", "contexts",
	"firstSeen", "lastSeen", "seenCount", "accepted", "turnedIn",
}

--- One quest per line keeps a large export readable and diff-friendly.
function Export.ToJSON(document)
	local header = EncodeObject(document, DOCUMENT_KEYS)
	local lines = {}
	for i, quest in ipairs(document.quests) do
		lines[i] = EncodeObject(quest, QUEST_KEYS)
	end
	local body = #lines > 0 and ("\n" .. table.concat(lines, ",\n") .. "\n") or ""
	return header:sub(1, -2) .. ',"quests":[' .. body .. "]}"
end

-- CSV -------------------------------------------------------------------------

local CSV_COLUMNS = {
	"id", "title", "state", "level", "giverType", "giverId", "giverName", "map", "x", "y", "faction",
	"contexts", "firstSeen", "lastSeen", "seenCount", "accepted", "turnedIn",
}

local function CsvField(value)
	if value == nil then
		return ""
	end
	local text = type(value) == "number" and EncodeNumber(value) or tostring(value)
	if text:find('[,"\r\n]') then
		return '"' .. text:gsub('"', '""') .. '"'
	end
	return text
end

function Export.ToCSV(document)
	local lines = { table.concat(CSV_COLUMNS, ",") }
	for _, quest in ipairs(document.quests) do
		local giver = quest.giver or {}
		local row = {
			quest.id, quest.title, quest.state, quest.level, giver.type, giver.id, giver.name,
			quest.map, quest.x, quest.y, quest.faction, table.concat(quest.contexts, ";"),
			quest.firstSeen, quest.lastSeen, quest.seenCount, quest.accepted, quest.turnedIn,
		}
		local fields = {}
		for i = 1, #CSV_COLUMNS do
			fields[i] = CsvField(row[i])
		end
		table.insert(lines, table.concat(fields, ","))
	end
	return table.concat(lines, "\n")
end
