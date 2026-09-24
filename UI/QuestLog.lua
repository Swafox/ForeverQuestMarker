local _, ns = ...

local Badge = ns.Badge
local Tooltip = ns.Tooltip
local Display = ns.Display

-- Marks quests in the quest log (the world map side panel on this client). Title
-- buttons come from QuestScrollFrame.titleFramePool and are rebuilt by
-- QuestLogQuests_Update. While the questPOI CVar is on, Blizzard places a POI button
-- in the indent left of every title, so the marker is a pip on that button's corner,
-- as on the quest icons in quest giver lists.

local function FindPOIButton(questID)
	local contents = QuestScrollFrame.Contents
	if contents and contents.FindButtonByQuestID then
		local poiButton = contents:FindButtonByQuestID(questID)
		if poiButton and poiButton:IsShown() then
			return poiButton
		end
	end
	return nil
end

local function MarkButton(button)
	local marker = Display.GetMarker(button.questID, "markQuestLog")
	if not marker then
		Badge.HideOn(button)
		return
	end
	local layout = Badge.GetLayout("questLog")
	local texture = Badge.Acquire(button)
	texture:ClearAllPoints()
	local poiButton = FindPOIButton(button.questID)
	if poiButton then
		texture:SetPoint("CENTER", poiButton, "BOTTOMRIGHT", layout.x, layout.y)
		Badge.SetAbove(button, poiButton)
	else
		texture:SetPoint("TOPRIGHT", button.Text, "TOPLEFT", -3, 0)
		Badge.SetAbove(button)
	end
	Badge.Apply(texture, marker, layout.size)
end

local function Refresh()
	local pool = QuestScrollFrame and QuestScrollFrame.titleFramePool
	if not pool then
		return
	end
	for button in pool:EnumerateActive() do
		MarkButton(button)
	end
end

-- Blizzard shows the title tooltip first, then fires this event.
local function OnTitleEnter(_, button, questID)
	if GameTooltip:IsOwned(button) and Tooltip.AddQuestLines(GameTooltip, questID) then
		GameTooltip:Show()
	end
end

ns.Integrations.Register({
	key = "questLog",
	label = "Quest log",
	Install = function()
		if type(QuestLogQuests_Update) ~= "function" then
			return false, "QuestLogQuests_Update missing"
		end
		if not (QuestScrollFrame and QuestScrollFrame.titleFramePool) then
			return false, "QuestScrollFrame.titleFramePool missing"
		end
		hooksecurefunc("QuestLogQuests_Update", function()
			ns.SafeCall("QuestLogQuests_Update", Refresh)
		end)

		local detail
		if EventRegistry and EventRegistry.RegisterCallback then
			EventRegistry:RegisterCallback("QuestMapLogTitleButton.OnEnter", function(...)
				ns.SafeCall("quest log tooltip", OnTitleEnter, ...)
			end, ns)
		else
			detail = "no tooltip hook"
		end
		return true, detail
	end,
	Refresh = Refresh,
})
