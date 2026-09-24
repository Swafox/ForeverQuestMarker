local _, ns = ...

local State = ns.State
local Classifier = ns.Classifier
local DB = ns.DB

-- Remembers quests the player encounters so they can be shared with /fqm export.
-- It listens to game events directly rather than to the UI hooks, so it keeps
-- working when another addon replaces the quest or gossip windows.

local Recorder = {}
ns.Recorder = Recorder

local MAX_TITLE_BYTES = 200
-- The submission pipeline accepts up to 5000 quests per export.
local MAX_RECORDS = 5000
-- Once this many records exist, only quests that are not original Classic are added.
local MAX_CLASSIC_RECORDS = 3500
local MAX_LEVEL = 100
-- Repeated sightings within this window count once.
local SEEN_INTERVAL = 60
-- Contexts where an NPC shows the quest. Only these count as sightings and record
-- where the player stands, since the quest log is scanned wherever the player is.
local SIGHTING_CONTEXTS = {
	detail = true,
	progress = true,
	complete = true,
	gossip = true,
	greeting = true,
}
local LOG_SCAN_DELAY = 2

local recordCount = 0

--- Removes WoW escape sequences so exported titles are plain text.
function Recorder.SanitizeTitle(title)
	if type(title) ~= "string" then
		return nil
	end
	local text = title
		:gsub("|c%x%x%x%x%x%x%x%x", "")
		:gsub("|r", "")
		:gsub("|H.-|h(.-)|h", "%1")
		:gsub("|T.-|t", "")
		:gsub("|A.-|a", "")
		:gsub("|n", " ")
		:gsub("|", "")
		:gsub("[%c]", " ")
		:gsub("%s+", " ")
		:gsub("^ ", "")
		:gsub(" $", "")
	if #text > MAX_TITLE_BYTES then
		-- Cut on a byte boundary, then drop a trailing partial UTF-8 sequence.
		text = text:sub(1, MAX_TITLE_BYTES):gsub("[\192-\255][\128-\191]*$", "")
	end
	if text == "" then
		return nil
	end
	return text
end

local GIVER_TYPES = {
	Creature = "npc",
	Vehicle = "npc",
	Pet = "npc",
	GameObject = "object",
}

local function IsReadable(value)
	return not (issecretvalue and issecretvalue(value))
end

--- Describes the unit offering or accepting a quest ("npc", "questnpc").
function Recorder.GetGiverFromUnit(unit)
	local guid = UnitGUID(unit)
	if type(guid) ~= "string" or not IsReadable(guid) then
		return nil
	end
	local unitType, _, _, _, _, id = strsplit("-", guid)
	local giverType = GIVER_TYPES[unitType]
	if not giverType then
		return nil
	end
	local name = UnitName(unit)
	return {
		type = giverType,
		id = tonumber(id),
		name = IsReadable(name) and Recorder.SanitizeTitle(name) or nil,
	}
end

local function Round(value)
	return math.floor(value * 1000 + 0.5) / 1000
end

local function GetPlayerLocation()
	local mapID = C_Map.GetBestMapForUnit("player")
	if not mapID or not IsReadable(mapID) then
		return nil
	end
	local position = C_Map.GetPlayerMapPosition(mapID, "player")
	if not position then
		return mapID
	end
	local x, y = position:GetXY()
	if not (x and y and IsReadable(x) and IsReadable(y)) or (x == 0 and y == 0) then
		return mapID
	end
	-- Positions just past a map's edge fall outside 0..1; they are not useful.
	if x < 0 or x > 1 or y < 0 or y > 1 then
		return mapID
	end
	return mapID, Round(x), Round(y)
end

local function ShouldRecord(state, isNewRecord)
	if not DB.GetSetting("recorder") or state == State.UNKNOWN then
		return false
	end
	local isClassic = state == State.CLASSIC or state == State.CHANGED
	if isClassic and not DB.GetSetting("recordClassic") then
		return false
	end
	if isNewRecord then
		if recordCount >= MAX_RECORDS then
			return false
		end
		if isClassic and recordCount >= MAX_CLASSIC_RECORDS then
			return false
		end
	end
	return true
end

--- Records one sighting of a quest.
--- info = { title, level, giver = { type, id, name }, accepted, turnedIn, existingOnly }
--- `existingOnly` updates a record without creating one.
function Recorder.Observe(questID, context, info)
	local state = Classifier.Classify(questID)
	local observations = ns.db.observations
	local record = observations[questID]
	info = info or {}
	if (info.existingOnly and not record) or not ShouldRecord(state, record == nil) then
		return nil
	end
	local now = time()
	local isSighting = SIGHTING_CONTEXTS[context] == true

	if not record then
		record = {
			id = questID,
			firstSeen = now,
			lastSeen = now,
			seenCount = 1,
			lastCounted = isSighting and now or nil,
			contexts = {},
			faction = UnitFactionGroup("player"),
		}
		observations[questID] = record
		recordCount = recordCount + 1
	elseif isSighting and now - (record.lastCounted or 0) >= SEEN_INTERVAL then
		record.seenCount = record.seenCount + 1
		record.lastCounted = now
	end
	if isSighting and not record.map then
		record.map, record.x, record.y = GetPlayerLocation()
	end

	record.state = state
	local title = Recorder.SanitizeTitle(info.title)
	if title then
		record.title = title
	end
	if type(info.level) == "number" and info.level > 0 and info.level <= MAX_LEVEL then
		record.level = info.level
	end
	if info.giver and not record.giver then
		record.giver = info.giver
	end
	if info.accepted then
		record.accepted = true
	end
	if info.turnedIn then
		record.turnedIn = true
	end
	record.contexts[context] = true
	record.lastSeen = now
	return record
end

function Recorder.Count()
	return recordCount
end

function Recorder.CountByState()
	local counts = {}
	for _, record in pairs(ns.db.observations) do
		counts[record.state] = (counts[record.state] or 0) + 1
	end
	return counts
end

function Recorder.Reset()
	local deleted = recordCount
	ns.db.observations = {}
	recordCount = 0
	return deleted
end

-- Event handlers ---------------------------------------------------------------

local function GetQuestLevel(questID)
	local level = C_QuestLog.GetQuestDifficultyLevel(questID)
	if type(level) == "number" and level > 0 then
		return level
	end
	return nil
end

local function ObserveOffer(context, giver)
	local questID = GetQuestID()
	if questID and questID > 0 then
		Recorder.Observe(questID, context, {
			title = GetTitleText(),
			level = GetQuestLevel(questID),
			giver = giver,
		})
	end
end

local function OnQuestDetail(questStartItemID)
	local giver
	if type(questStartItemID) == "number" and questStartItemID > 0 then
		giver = { type = "item", id = questStartItemID }
	else
		giver = Recorder.GetGiverFromUnit("questnpc")
	end
	ObserveOffer("detail", giver)
end

local function OnGossipShow()
	local giver = Recorder.GetGiverFromUnit("npc")
	for _, info in ipairs(C_GossipInfo.GetAvailableQuests() or {}) do
		Recorder.Observe(info.questID, "gossip", { title = info.title, level = info.questLevel, giver = giver })
	end
	for _, info in ipairs(C_GossipInfo.GetActiveQuests() or {}) do
		Recorder.Observe(info.questID, "gossip", { title = info.title, level = info.questLevel })
	end
end

local function OnQuestGreeting()
	local giver = Recorder.GetGiverFromUnit("questnpc")
	for i = 1, GetNumAvailableQuests() do
		local questID = select(5, GetAvailableQuestInfo(i))
		if questID then
			Recorder.Observe(questID, "greeting", { title = GetAvailableTitle(i), giver = giver })
		end
	end
	for i = 1, GetNumActiveQuests() do
		local questID = GetActiveQuestID(i)
		if questID then
			Recorder.Observe(questID, "greeting", { title = GetActiveTitle(i) })
		end
	end
end

local function IsHiddenQuest(questID)
	local index = C_QuestLog.GetLogIndexForQuestID(questID)
	local info = index and C_QuestLog.GetInfo(index)
	return info ~= nil and info.isHidden == true
end

local function OnQuestAccepted(questID)
	-- Hidden quests are internal flags, not quests a player sees.
	if IsHiddenQuest(questID) then
		return
	end
	Recorder.Observe(questID, "accepted", {
		title = C_QuestLog.GetTitleForQuestID(questID),
		level = GetQuestLevel(questID),
		accepted = true,
	})
end

local function OnQuestTurnedIn(questID)
	-- Many hidden flag quests complete silently; only update quests seen before.
	Recorder.Observe(questID, "turnedIn", {
		title = C_QuestLog.GetTitleForQuestID(questID),
		turnedIn = true,
		existingOnly = true,
	})
end

-- Quests offered by an item or an area trigger skip the quest window: QuestFrame
-- queues an auto quest pop-up and closes the offer before QUEST_DETAIL reaches us.
local function OnAutoQuestPopUp(questID, popUpType, itemID)
	if popUpType ~= "OFFER" or type(questID) ~= "number" or questID <= 0 then
		return
	end
	local title = C_QuestLog.GetTitleForQuestID(questID)
	if not title then
		C_QuestLog.RequestLoadQuestByID(questID)
	end
	local giver
	if type(itemID) == "number" and itemID > 0 then
		giver = { type = "item", id = itemID }
	end
	Recorder.Observe(questID, "detail", { title = title, giver = giver })
end

-- Fills in titles that were not cached when a quest was first seen.
local function OnQuestDataLoaded(questID, success)
	local record = success and ns.db.observations[questID]
	if record and not record.title then
		record.title = Recorder.SanitizeTitle(C_QuestLog.GetTitleForQuestID(questID))
	end
end

function Recorder.ScanQuestLog()
	for index = 1, C_QuestLog.GetNumQuestLogEntries() do
		local info = C_QuestLog.GetInfo(index)
		if info and not info.isHeader and not info.isHidden and info.questID and info.questID > 0 then
			-- Forever's quest log shows difficultyLevel; record the same number.
			Recorder.Observe(info.questID, "log", { title = info.title, level = info.difficultyLevel or info.level })
		end
	end
end

local scanPending = false
local function ScheduleQuestLogScan()
	if scanPending then
		return
	end
	scanPending = true
	C_Timer.After(LOG_SCAN_DELAY, function()
		scanPending = false
		ns.SafeCall("quest log scan", Recorder.ScanQuestLog)
	end)
end

function Recorder.Enable()
	for _ in pairs(ns.db.observations) do
		recordCount = recordCount + 1
	end
	ns:RegisterEvent("QUEST_DETAIL", OnQuestDetail)
	ns:RegisterEvent("QUEST_PROGRESS", function()
		ObserveOffer("progress")
	end)
	ns:RegisterEvent("QUEST_COMPLETE", function()
		ObserveOffer("complete")
	end)
	ns:RegisterEvent("GOSSIP_SHOW", OnGossipShow)
	ns:RegisterEvent("QUEST_GREETING", OnQuestGreeting)
	ns:RegisterEvent("QUEST_ACCEPTED", OnQuestAccepted)
	ns:RegisterEvent("QUEST_TURNED_IN", OnQuestTurnedIn)
	ns:RegisterEvent("QUEST_LOG_UPDATE", ScheduleQuestLogScan)
	ns:RegisterEvent("QUEST_DATA_LOAD_RESULT", OnQuestDataLoaded)
	local tracker = QuestObjectiveTracker
	if tracker and type(tracker.AddAutoQuestPopUp) == "function" then
		hooksecurefunc(tracker, "AddAutoQuestPopUp", function(_, questID, popUpType, itemID)
			ns.SafeCall("auto quest offer", OnAutoQuestPopUp, questID, popUpType, itemID)
		end)
	end
	ScheduleQuestLogScan()
end
