local _, ns = ...

-- Where quests come from: which NPC or object offers them and where it stands.
-- Two sources, merged: the community list shipped in Data/Places.lua (consensus of
-- player reports, reviewed before release) and the player's own recorded quests.
-- The giver index is built on first use and rebuilt only after the recorder learns
-- a new giver, so a tooltip lookup is a single table read.

local Places = {}
ns.Places = Places

Places.Source = {
	COMMUNITY = "community",
	OWN = "own",
}

local EMPTY = {}
local giverIndex
local zoneCache = {}

local function GiverKey(giverType, id)
	return giverType .. ":" .. id
end

local function IsGiver(giverType, id)
	return type(giverType) == "string" and type(id) == "number" and id > 0
end

local function BuildIndex()
	local index, seen = {}, {}
	local function Add(giverType, id, questID)
		if not IsGiver(giverType, id) or type(questID) ~= "number" then
			return
		end
		local key = GiverKey(giverType, id)
		seen[key] = seen[key] or {}
		if seen[key][questID] then
			return
		end
		seen[key][questID] = true
		index[key] = index[key] or {}
		table.insert(index[key], questID)
	end
	for questID, entry in pairs(ns.Data.places or EMPTY) do
		Add(entry[1], entry[2], questID)
	end
	for questID, record in pairs(ns.db and ns.db.observations or EMPTY) do
		local giver = record.giver
		if type(giver) == "table" then
			Add(giver.type, giver.id, questID)
		end
	end
	for _, quests in pairs(index) do
		table.sort(quests)
	end
	giverIndex = index
end

--- Forgets the giver index; the next lookup rebuilds it. The recorder calls this
--- when it learns a giver.
function Places.Invalidate()
	giverIndex = nil
end

--- Quest IDs offered by an NPC (`"npc"`) or game object (`"object"`), sorted.
--- The returned list is shared; callers must not modify it.
function Places.GetQuestsByGiver(giverType, id)
	if not IsGiver(giverType, id) then
		return EMPTY
	end
	if not giverIndex then
		BuildIndex()
	end
	return giverIndex[GiverKey(giverType, id)] or EMPTY
end

local function IsCoordinate(value)
	return type(value) == "number" and value >= 0 and value <= 1
end

--- Where a quest is picked up: uiMapID, x, y (x and y may be nil) and the source.
--- Community data wins over the player's own sighting.
function Places.GetLocation(questID)
	local entry = ns.Data.places and ns.Data.places[questID]
	if entry and type(entry[3]) == "number" then
		if IsCoordinate(entry[4]) and IsCoordinate(entry[5]) then
			return entry[3], entry[4], entry[5], Places.Source.COMMUNITY
		end
		return entry[3], nil, nil, Places.Source.COMMUNITY
	end
	local record = ns.db and ns.db.observations[questID]
	if record and type(record.map) == "number" then
		if IsCoordinate(record.x) and IsCoordinate(record.y) then
			return record.map, record.x, record.y, Places.Source.OWN
		end
		return record.map, nil, nil, Places.Source.OWN
	end
	return nil
end

--- The zone a map belongs to: walks up from dungeons, micro maps and orphans to the
--- enclosing zone map. Returns zoneMapID, name; the name falls back to the map ID.
function Places.GetZone(mapID)
	local cached = zoneCache[mapID]
	if cached then
		return cached[1], cached[2]
	end
	local zoneType = Enum.UIMapType and Enum.UIMapType.Zone or 3
	local current = mapID
	local info = C_Map.GetMapInfo(current)
	local hops = 0
	while info and info.mapType and info.mapType > zoneType and info.parentMapID and info.parentMapID > 0 and hops < 5 do
		local parent = C_Map.GetMapInfo(info.parentMapID)
		if not parent then
			break
		end
		current, info, hops = info.parentMapID, parent, hops + 1
	end
	local name = info and info.name
	if type(name) ~= "string" or name == "" then
		name = ns.L.JOURNAL_MAP_FALLBACK:format(mapID)
	end
	zoneCache[mapID] = { current, name }
	return current, name
end

--- Puts Blizzard's own map waypoint on a quest's pickup spot and tracks it.
--- Returns true on success, or false and a reason key ("unknown", "map").
function Places.Track(questID)
	local mapID, x, y = Places.GetLocation(questID)
	if not (mapID and x and y) then
		return false, "unknown"
	end
	if not C_Map.CanSetUserWaypointOnMap(mapID) then
		return false, "map"
	end
	C_Map.SetUserWaypoint(UiMapPoint.CreateFromCoordinates(mapID, x, y))
	C_SuperTrack.SetSuperTrackedUserWaypoint(true)
	return true
end

--- Number of quests with a known giver in the shipped community data.
function Places.CountCommunity()
	local count = 0
	for _ in pairs(ns.Data.places or EMPTY) do
		count = count + 1
	end
	return count
end
