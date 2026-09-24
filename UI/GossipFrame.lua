local _, ns = ...

local Badge = ns.Badge
local Display = ns.Display
local Tooltip = ns.Tooltip

-- Marks quests listed by quest givers: the gossip window (C_GossipInfo, a
-- ScrollBox of pooled buttons) and the older quest greeting page of the quest
-- window (GetNumAvailableQuests and friends). The marker is a small pip on the
-- corner of the quest's "!" or "?" icon, and hovering the row explains it.

local rowQuest = setmetatable({}, { __mode = "k" })
local hookedRows = setmetatable({}, { __mode = "k" })

local function OnRowEnter(row)
	local questID = rowQuest[row]
	if questID then
		ns.SafeCall("quest row tooltip", Tooltip.ShowFor, row, questID)
	end
end

local function OnRowLeave(row)
	if rowQuest[row] then
		Tooltip.HideFor(row)
	end
end

local function MarkRow(row, questID, context, icon)
	local marker = questID and Display.GetMarker(questID, "markGossip")
	if not marker then
		Badge.HideOn(row)
		rowQuest[row] = nil
		return
	end

	local layout = Badge.GetLayout(context)
	local texture = Badge.Acquire(row)
	texture:ClearAllPoints()
	if icon then
		texture:SetPoint("CENTER", icon, "BOTTOMRIGHT", layout.x, layout.y)
	else
		texture:SetPoint("LEFT", row, "LEFT", layout.x, layout.y)
	end
	Badge.Apply(texture, marker, layout.size)

	rowQuest[row] = questID
	if not hookedRows[row] then
		hookedRows[row] = true
		row:HookScript("OnEnter", OnRowEnter)
		row:HookScript("OnLeave", OnRowLeave)
	end
end

--- Quest ID shown by a marked row, for diagnostics.
function ns.GetRowQuest(row)
	return rowQuest[row]
end

-- Gossip ---------------------------------------------------------------------

local function GetGossipQuestID(elementData)
	if type(elementData) ~= "table" or type(elementData.info) ~= "table" then
		return nil
	end
	local buttonType = elementData.buttonType
	if buttonType == GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST or buttonType == GOSSIP_BUTTON_TYPE_ACTIVE_QUEST then
		return elementData.info.questID
	end
	return nil
end

local function MarkGossipFrame(frame, elementData)
	MarkRow(frame, GetGossipQuestID(elementData), "gossip", frame.Icon)
end

local function GetGossipScrollBox()
	local panel = GossipFrame and GossipFrame.GreetingPanel
	return panel and panel.ScrollBox
end

local function RefreshGossip()
	local scrollBox = GetGossipScrollBox()
	if scrollBox and GossipFrame:IsShown() then
		scrollBox:ForEachFrame(function(frame, elementData)
			MarkGossipFrame(frame, elementData)
		end)
	end
end

ns.Integrations.Register({
	key = "gossip",
	label = "Gossip quest lists",
	Install = function()
		local scrollBox = GetGossipScrollBox()
		if not scrollBox then
			return false, "GossipFrame.GreetingPanel.ScrollBox missing"
		end
		if not (GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST and GOSSIP_BUTTON_TYPE_ACTIVE_QUEST) then
			return false, "GOSSIP_BUTTON_TYPE constants missing"
		end

		if ScrollUtil and ScrollUtil.AddInitializedFrameCallback then
			-- Fires after Blizzard's initializer, every time a row is (re)used.
			ScrollUtil.AddInitializedFrameCallback(scrollBox, function(_, frame, elementData)
				ns.SafeCall("gossip row", MarkGossipFrame, frame, elementData)
			end, ns)
			return true
		end

		-- Fallback for clients without ScrollUtil callbacks: mark after each update.
		hooksecurefunc(GossipFrame, "Update", function()
			ns.SafeCall("GossipFrame.Update", RefreshGossip)
		end)
		return true, "using GossipFrame.Update fallback"
	end,
	Refresh = RefreshGossip,
})

-- Quest greeting (quest window listing several quests) -----------------------

local function GetGreetingQuestID(button)
	local index = button:GetID()
	if button.isActive == 1 then
		return GetActiveQuestID(index)
	end
	-- GetAvailableQuestInfo returns the quest ID fifth, as QuestFrame.lua uses it.
	return select(5, GetAvailableQuestInfo(index))
end

local function RefreshGreeting()
	local panel = QuestFrameGreetingPanel
	if not (panel and panel:IsShown() and panel.titleButtonPool) then
		return
	end
	for button in panel.titleButtonPool:EnumerateActive() do
		MarkRow(button, GetGreetingQuestID(button), "greeting", button.Icon)
	end
end

ns.Integrations.Register({
	key = "greeting",
	label = "Quest greeting lists",
	Install = function()
		local panel = QuestFrameGreetingPanel
		if not (panel and panel.titleButtonPool) then
			return false, "QuestFrameGreetingPanel.titleButtonPool missing"
		end
		local function OnGreeting()
			ns.SafeCall("QuestFrameGreetingPanel", RefreshGreeting)
		end
		-- The XML binds OnShow to the function itself, so the global hook alone would
		-- miss it; QUEST_LOG_UPDATE calls the global directly, so hook both.
		panel:HookScript("OnShow", OnGreeting)
		if type(QuestFrameGreetingPanel_OnShow) == "function" then
			hooksecurefunc("QuestFrameGreetingPanel_OnShow", OnGreeting)
		end
		return true
	end,
	Refresh = RefreshGreeting,
})
