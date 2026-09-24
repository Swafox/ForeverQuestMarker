local _, ns = ...

local Badge = ns.Badge
local Display = ns.Display
local Tooltip = ns.Tooltip
local DB = ns.DB

-- Marks the quest title in the quest giver window (offer, progress and reward
-- pages) and in quest details opened from the quest log or world map. The marker
-- is inline text markup, the same technique Blizzard uses for its own quest type
-- icons in these titles, so it follows the title's wrapping and layout.

-- fontString -> { text = what we set, prefix = our marker part, base = the title without it, questID }
local applied = setmetatable({}, { __mode = "k" })
local hoverFrames = setmetatable({}, { __mode = "k" })

local function GetBaseText(fontString)
	local text = fontString:GetText() or ""
	local last = applied[fontString]
	if last and text == last.text then
		return last.base
	end
	-- Another addon rewrote the title after us and kept our prefix: remove it exactly.
	if last and last.prefix ~= "" then
		local first, finish = text:find(last.prefix, 1, true)
		if first then
			text = text:sub(1, first - 1) .. text:sub(finish + 1)
		end
	end
	-- Blizzard set a fresh title; drop any stale marker of ours regardless.
	return (text:gsub(Badge.MARKUP_PATTERN .. " ?", ""))
end

local function OnHoverEnter(self)
	ns.SafeCall("title tooltip", Tooltip.ShowFor, self, self.questID)
end

local function OnHoverLeave(self)
	Tooltip.HideFor(self)
end

-- An invisible frame over the inline marker gives it a tooltip.
local function GetHoverFrame(fontString)
	local frame = hoverFrames[fontString]
	if not frame then
		frame = CreateFrame("Frame", nil, fontString:GetParent())
		-- Hover only; clicks pass through to the quest text.
		frame:SetMouseMotionEnabled(true)
		frame:SetMouseClickEnabled(false)
		frame:SetScript("OnEnter", OnHoverEnter)
		frame:SetScript("OnLeave", OnHoverLeave)
		hoverFrames[fontString] = frame
	end
	return frame
end

local function UpdateHoverFrame(fontString, questID, marker, size)
	local frame = GetHoverFrame(fontString)
	if not marker or not DB.GetSetting("tooltips") then
		frame:Hide()
		return
	end
	local parent = fontString:GetParent()
	frame:SetParent(parent)
	frame:SetFrameLevel(parent:GetFrameLevel() + 5)
	frame:ClearAllPoints()
	frame:SetPoint("TOPLEFT", fontString, "TOPLEFT", 0, 0)
	frame:SetSize(size + 2, size + 2)
	frame.questID = questID
	frame:Show()
end

local function MarkTitle(fontString, questID)
	local base = GetBaseText(fontString)
	local marker = Display.GetMarker(questID, "markQuestFrame")
	local layout = Badge.GetLayout("title")

	local prefix = ""
	if marker then
		prefix = Badge.GetMarkup(marker, layout.size, layout.y)
		if DB.GetSetting("textTags") then
			prefix = prefix .. " " .. Display.GetTag(marker)
		end
		prefix = prefix .. " "
	end
	local text = prefix .. base
	if text ~= fontString:GetText() then
		fontString:SetText(text)
	end
	applied[fontString] = { text = text, prefix = prefix, base = base, questID = questID }
	UpdateHoverFrame(fontString, questID, marker, layout.size)
	return marker
end

--- The marker applied to a title, for diagnostics.
function ns.GetTitleMarkerState(fontString)
	local last = applied[fontString]
	return last and last.questID, last and Display.GetMarker(last.questID, "markQuestFrame")
end

local function OnQuestInfoDisplay(template)
	local questID
	if template and template.questLog then
		questID = C_QuestLog.GetSelectedQuest()
	else
		questID = GetQuestID()
	end
	MarkTitle(QuestInfoTitleHeader, questID)
end

local function OnProgressShow()
	MarkTitle(QuestProgressTitleText, GetQuestID())
end

local function Refresh()
	for fontString, last in pairs(applied) do
		if fontString:IsVisible() then
			MarkTitle(fontString, last.questID)
		end
	end
end

ns.Integrations.Register({
	key = "questFrame",
	label = "Quest window titles",
	Install = function()
		if type(QuestInfo_Display) ~= "function" or not QuestInfoTitleHeader then
			return false, "QuestInfo_Display or QuestInfoTitleHeader missing"
		end
		hooksecurefunc("QuestInfo_Display", function(template)
			ns.SafeCall("QuestInfo_Display", OnQuestInfoDisplay, template)
		end)

		local detail
		if QuestFrameProgressPanel and QuestProgressTitleText then
			QuestFrameProgressPanel:HookScript("OnShow", function()
				ns.SafeCall("QuestFrameProgressPanel", OnProgressShow)
			end)
		else
			detail = "progress page not found"
		end
		return true, detail
	end,
	Refresh = Refresh,
})
