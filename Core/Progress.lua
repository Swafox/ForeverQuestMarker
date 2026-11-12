local _, ns = ...

local State = ns.State
local Classifier = ns.Classifier
local Places = ns.Places

-- Completion of Forever's new quests, grouped by zone, for the journal. Built on
-- demand when the journal opens or a quest is turned in; nothing runs in between.

local Progress = {}
ns.Progress = Progress

local function IsDone(questID)
	return C_QuestLog.IsQuestFlaggedCompleted(questID) == true
end

local function IsActive(questID)
	return C_QuestLog.IsOnQuest(questID) == true
end

-- Titles already requested this session; hidden flag quests never load, and asking
-- again on every refresh would keep the journal refreshing.
local requested = {}

--- Title for display: the client's cache, then the player's own recording.
--- Asks the client once per session to load an uncached title; a successful
--- QUEST_DATA_LOAD_RESULT then refreshes an open journal.
function Progress.GetTitle(questID)
	local title = C_QuestLog.GetTitleForQuestID(questID)
	if type(title) == "string" and title ~= "" then
		return title
	end
	local record = ns.db and ns.db.observations[questID]
	if record and record.title then
		return record.title
	end
	if not requested[questID] then
		requested[questID] = true
		C_QuestLog.RequestLoadQuestByID(questID)
	end
	return nil
end

local function NewGroup(zoneID, name)
	return { zoneID = zoneID, name = name, total = 0, done = 0, quests = {} }
end

local function Count(group, quest)
	group.total = group.total + 1
	if quest.done then
		group.done = group.done + 1
	end
end

--- Snapshot of the player's progress:
--- { total, done, zones = { { zoneID, name, total, done, quests = { quest, ... } }, ... },
---   unlocated = { total, done } }
--- where quest = { id, state, done, active, title, mapID, x, y }. Zones are sorted by
--- name, quests by not-done first, then title. Confirmed quests always count; likely
--- new quests the player recorded are listed too, since they are new to the player.
function Progress.Collect()
	local result = { total = 0, done = 0, zones = {}, unlocated = { total = 0, done = 0 } }
	local byZone = {}

	local function Add(questID, state)
		local quest = { id = questID, state = state, done = IsDone(questID), active = IsActive(questID) }
		Count(result, quest)
		local mapID, x, y = Places.GetLocation(questID)
		if not mapID then
			Count(result.unlocated, quest)
			return
		end
		quest.mapID, quest.x, quest.y = mapID, x, y
		quest.title = Progress.GetTitle(questID)
		local zoneID, name = Places.GetZone(mapID)
		local group = byZone[zoneID]
		if not group then
			group = NewGroup(zoneID, name)
			byZone[zoneID] = group
			table.insert(result.zones, group)
		end
		Count(group, quest)
		table.insert(group.quests, quest)
	end

	Classifier.ForEachConfirmed(function(questID)
		Add(questID, State.CONFIRMED)
	end)
	for questID, record in pairs(ns.db.observations) do
		if record.state == State.INFERRED and Classifier.Classify(questID) == State.INFERRED then
			Add(questID, State.INFERRED)
		end
	end

	table.sort(result.zones, function(a, b)
		return a.name < b.name
	end)
	for _, group in ipairs(result.zones) do
		table.sort(group.quests, function(a, b)
			if a.done ~= b.done then
				return not a.done
			end
			local titleA, titleB = a.title or "", b.title or ""
			if titleA ~= titleB then
				return titleA < titleB
			end
			return a.id < b.id
		end)
	end
	return result
end

--- Completed and total confirmed new quests, without grouping (compartment tooltip).
function Progress.CountConfirmed()
	local done, total = 0, 0
	Classifier.ForEachConfirmed(function(questID)
		total = total + 1
		if IsDone(questID) then
			done = done + 1
		end
	end)
	return done, total
end

--- The zone the player is in, for opening the journal at the right place.
function Progress.GetCurrentZone()
	local mapID = C_Map.GetBestMapForUnit("player")
	if type(mapID) ~= "number" or (issecretvalue and issecretvalue(mapID)) then
		return nil
	end
	return (Places.GetZone(mapID))
end
