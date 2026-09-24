local _, ns = ...

local Display = ns.Display

local Tooltip = {}
ns.Tooltip = Tooltip

local NOTE_COLOR = { 0.8, 0.8, 0.8 }

--- Appends the lines describing a quest's state. Returns true if anything was added.
function Tooltip.AddQuestLines(tooltip, questID)
	local headline, note, r, g, b = Display.GetTooltipInfo(questID)
	if not headline then
		return false
	end
	tooltip:AddLine(headline, r, g, b)
	if note then
		tooltip:AddLine(note, NOTE_COLOR[1], NOTE_COLOR[2], NOTE_COLOR[3], true)
	end
	return true
end

--- Explains a quest's marker when hovering `owner`. Extends Blizzard's tooltip if it
--- already belongs to `owner`, otherwise shows a new one.
function Tooltip.ShowFor(owner, questID, anchor)
	if GameTooltip:IsOwned(owner) and GameTooltip:IsShown() then
		if Tooltip.AddQuestLines(GameTooltip, questID) then
			GameTooltip:Show()
		end
		return
	end
	if not Display.GetTooltipInfo(questID) then
		return
	end
	GameTooltip:SetOwner(owner, anchor or "ANCHOR_RIGHT")
	Tooltip.AddQuestLines(GameTooltip, questID)
	GameTooltip:Show()
end

function Tooltip.HideFor(owner)
	if GameTooltip:IsOwned(owner) then
		GameTooltip:Hide()
	end
end

-- Quest hyperlinks (chat links, the quest log's "Share in chat", and so on).
local function OnQuestTooltip(tooltip, data)
	if tooltip:IsForbidden() then
		return
	end
	local questID = type(data) == "table" and data.id
	if type(questID) == "number" then
		Tooltip.AddQuestLines(tooltip, questID)
	end
end

ns.Integrations.Register({
	key = "questLinks",
	label = "Quest link tooltips",
	Install = function()
		if not (TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall) then
			return false, "TooltipDataProcessor.AddTooltipPostCall missing"
		end
		local questType = Enum.TooltipDataType and Enum.TooltipDataType.Quest
		if not questType then
			return false, "Enum.TooltipDataType.Quest missing"
		end
		TooltipDataProcessor.AddTooltipPostCall(questType, function(tooltip, data)
			ns.SafeCall("quest tooltip", OnQuestTooltip, tooltip, data)
		end)
		return true
	end,
})
