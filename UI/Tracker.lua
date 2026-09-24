local _, ns = ...

local Badge = ns.Badge
local Display = ns.Display
local Tooltip = ns.Tooltip

-- Marks tracked quests in the objective tracker. Blocks are pooled per module and
-- keyed by quest ID. Headers wrap freely, so the marker stays out of the text: it is
-- a pip on the quest's POI button, left of the header, or sits in that spot when the
-- tracker shows no POI buttons.

local MODULE_NAMES = { "QuestObjectiveTracker", "CampaignQuestObjectiveTracker" }

local function MarkBlock(block)
	local headerText = block.HeaderText
	if not headerText then
		return
	end
	local marker = type(block.id) == "number" and Display.GetMarker(block.id, "markTracker")
	if not marker then
		Badge.HideOn(block)
		return
	end
	local layout = Badge.GetLayout("tracker")
	local texture = Badge.Acquire(block)
	texture:ClearAllPoints()
	local poiButton = block.poiButton
	if poiButton and poiButton:IsShown() then
		texture:SetPoint("CENTER", poiButton, "BOTTOMRIGHT", layout.x, layout.y)
		Badge.SetAbove(block, poiButton)
	else
		texture:SetPoint("TOPRIGHT", headerText, "TOPLEFT", -4, 0)
		Badge.SetAbove(block)
	end
	Badge.Apply(texture, marker, layout.size)
end

local function RefreshModule(module)
	module:EnumerateActiveBlocks(MarkBlock)
end

local function Refresh()
	for _, name in ipairs(MODULE_NAMES) do
		local module = _G[name]
		if module and module.EnumerateActiveBlocks then
			RefreshModule(module)
		end
	end
end

-- Blizzard only shows a header tooltip in groups; otherwise we provide one, the
-- same way Blizzard's own PTR feedback addon does.
local function OnHeaderEnter(_, block, questID, isInGroup)
	if not Display.GetTooltipInfo(questID) then
		return
	end
	if isInGroup == false or not GameTooltip:IsOwned(block) then
		GameTooltip:ClearAllPoints()
		GameTooltip:SetPoint("TOPRIGHT", block, "TOPLEFT", 0, 0)
		GameTooltip:SetOwner(block, "ANCHOR_PRESERVE")
		local title = C_QuestLog.GetTitleForQuestID(questID)
		if title then
			GameTooltip:AddLine(title, 1, 1, 1)
		end
	end
	Tooltip.AddQuestLines(GameTooltip, questID)
	GameTooltip:Show()
end

ns.Integrations.Register({
	key = "tracker",
	label = "Objective tracker",
	loadsWith = "Blizzard_ObjectiveTracker",
	Install = function()
		local hooked = 0
		for _, name in ipairs(MODULE_NAMES) do
			local module = _G[name]
			if module and type(module.Update) == "function" and module.EnumerateActiveBlocks then
				hooksecurefunc(module, "Update", function(self)
					ns.SafeCall(name .. ".Update", RefreshModule, self)
				end)
				hooked = hooked + 1
			end
		end
		if hooked == 0 then
			return false, "QuestObjectiveTracker missing"
		end
		if EventRegistry and EventRegistry.RegisterCallback then
			EventRegistry:RegisterCallback("OnQuestBlockHeader.OnEnter", function(...)
				ns.SafeCall("tracker tooltip", OnHeaderEnter, ...)
			end, ns)
		end
		Refresh()
		return true, hooked .. " module(s)"
	end,
	Refresh = Refresh,
})

-- World map quest pins show a Blizzard tooltip first, then fire this event.
ns.Integrations.Register({
	key = "mapPins",
	label = "World map quest tooltips",
	Install = function()
		if not (EventRegistry and EventRegistry.RegisterCallback) then
			return false, "EventRegistry missing"
		end
		EventRegistry:RegisterCallback("MapCanvas.QuestPin.OnEnter", function(_, pin, questID)
			ns.SafeCall("map pin tooltip", function()
				if GameTooltip:IsOwned(pin) and Tooltip.AddQuestLines(GameTooltip, questID) then
					GameTooltip:Show()
				end
			end)
		end, ns)
		return true
	end,
})
