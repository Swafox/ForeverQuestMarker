local _, ns = ...

local L = ns.L
local DB = ns.DB
local Display = ns.Display
local Badge = ns.Badge
local Places = ns.Places
local Progress = ns.Progress

-- NPC tooltips: hovering a quest giver lists the new Forever quests it offers, from
-- the community list and the player's own recordings, with the player's progress.

local UnitTooltip = {}
ns.UnitTooltip = UnitTooltip

local MAX_LINES = 6
local MARKER_SIZE = 12
local HEADLINE_COLOR = { 0.902, 0.753, 0.404 }
local OPEN_COLOR = { 1, 1, 1 }
local ACTIVE_COLOR = { 1, 0.82, 0 }
local DONE_COLOR = { 0.5, 0.5, 0.5 }

--- NPC ID from a creature GUID, or nil for players, pets, objects and secret values.
function UnitTooltip.GetCreatureID(guid)
	if type(guid) ~= "string" or (issecretvalue and issecretvalue(guid)) then
		return nil
	end
	local unitType, _, _, _, _, id = strsplit("-", guid)
	if unitType ~= "Creature" and unitType ~= "Vehicle" then
		return nil
	end
	return tonumber(id)
end

--- Marked quests an NPC offers, open quests first:
--- { { id, marker, done, active }, ... }, plus the number already completed.
function UnitTooltip.Collect(npcID)
	local quests, done = {}, 0
	for _, questID in ipairs(Places.GetQuestsByGiver("npc", npcID)) do
		local marker = Display.GetMarker(questID, "unitTooltips")
		if marker then
			local quest = {
				id = questID,
				marker = marker,
				done = C_QuestLog.IsQuestFlaggedCompleted(questID) == true,
				active = C_QuestLog.IsOnQuest(questID) == true,
			}
			if quest.done then
				done = done + 1
			end
			table.insert(quests, quest)
		end
	end
	table.sort(quests, function(a, b)
		if a.done ~= b.done then
			return not a.done
		end
		return a.id < b.id
	end)
	return quests, done
end

local function QuestLine(quest)
	local title = Progress.GetTitle(quest.id) or L.QUEST_FALLBACK:format(quest.id)
	local text = Badge.GetMarkup(quest.marker, MARKER_SIZE) .. " " .. title
	if quest.done then
		return text .. " " .. L.UNIT_DONE, DONE_COLOR
	elseif quest.active then
		return text .. " " .. L.UNIT_ACTIVE, ACTIVE_COLOR
	end
	return text, OPEN_COLOR
end

--- Appends the quest summary for an NPC. Returns true if anything was added.
function UnitTooltip.AddLines(tooltip, npcID)
	local quests, done = UnitTooltip.Collect(npcID)
	if #quests == 0 then
		return false
	end
	local headline = done > 0 and L.UNIT_HEADLINE_DONE:format(#quests, done) or L.UNIT_HEADLINE:format(#quests)
	tooltip:AddLine(headline, HEADLINE_COLOR[1], HEADLINE_COLOR[2], HEADLINE_COLOR[3])
	local hideDone = DB.GetSetting("unitTooltipsHideDone")
	local shown, hidden = 0, 0
	for _, quest in ipairs(quests) do
		-- Completed quests stay counted in the headline when their lines are hidden.
		if not (quest.done and hideDone) then
			if shown < MAX_LINES then
				local text, color = QuestLine(quest)
				tooltip:AddLine(text, color[1], color[2], color[3])
				shown = shown + 1
			else
				hidden = hidden + 1
			end
		end
	end
	if hidden > 0 then
		tooltip:AddLine(L.UNIT_MORE:format(hidden), DONE_COLOR[1], DONE_COLOR[2], DONE_COLOR[3])
	end
	return true
end

local function OnUnitTooltip(tooltip, data)
	if tooltip:IsForbidden() or type(data) ~= "table" then
		return
	end
	local npcID = UnitTooltip.GetCreatureID(data.guid)
	if npcID then
		UnitTooltip.AddLines(tooltip, npcID)
	end
end

ns.Integrations.Register({
	key = "unitTooltips",
	label = "NPC tooltips",
	Install = function()
		if not (TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall) then
			return false, "TooltipDataProcessor.AddTooltipPostCall missing"
		end
		local unitType = Enum.TooltipDataType and Enum.TooltipDataType.Unit
		if not unitType then
			return false, "Enum.TooltipDataType.Unit missing"
		end
		TooltipDataProcessor.AddTooltipPostCall(unitType, function(tooltip, data)
			ns.SafeCall("unit tooltip", OnUnitTooltip, tooltip, data)
		end)
		return true
	end,
})
