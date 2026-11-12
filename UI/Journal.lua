local _, ns = ...

local L = ns.L
local State = ns.State
local Display = ns.Display
local Badge = ns.Badge
local Places = ns.Places
local Progress = ns.Progress
local Tooltip = ns.Tooltip

-- The journal: how many of Forever's new quests the player has done, by zone, with
-- a click to put Blizzard's map waypoint on a quest's pickup spot. The list is
-- virtual: a fixed set of rows (FauxScrollFrameTemplate) is refilled on scroll, so
-- expanding every zone costs no extra frames. Progress is recomputed only when the
-- journal opens or the quest log changes while it is open.

local Journal = {}
ns.Journal = Journal

local FRAME_NAME = "ForeverQuestMarkerJournal"
local WIDTH, HEIGHT = 460, 540
local ROW_HEIGHT = 20
local MARKER_SIZE = 14
local BAR_HEIGHT = 12
-- The list area: below the summary, bar and hint; above the filter button.
local LIST_TOP, LIST_BOTTOM = -96, 40
local NUM_ROWS = math.floor((HEIGHT + LIST_TOP - LIST_BOTTOM) / ROW_HEIGHT)
local REFRESH_DELAY = 1

local GOLD = { 0.902, 0.753, 0.404 }
local WHITE = { 1, 1, 1 }
local GREY = { 0.55, 0.55, 0.55 }
local GREEN = { 0.35, 0.8, 0.35 }
local YELLOW = { 1, 0.82, 0 }

local window
local rows = {}
local entries = {}
local snapshot
local refreshPending = false

--- 1818 -> "1,818".
function Journal.FormatNumber(value)
	local text = tostring(math.floor(value))
	local formatted = text:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (formatted:gsub("^,", ""))
end
local FormatNumber = Journal.FormatNumber

local function Percent(done, total)
	if total <= 0 then
		return 0
	end
	return math.floor(done / total * 100)
end

local function GetState()
	ns.db.journal = type(ns.db.journal) == "table" and ns.db.journal or {}
	local state = ns.db.journal
	state.expanded = type(state.expanded) == "table" and state.expanded or {}
	return state
end

-- Rows ---------------------------------------------------------------------------

local function ShowQuestTooltip(row)
	local quest = row.quest
	GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
	GameTooltip:AddLine(quest.title or L.QUEST_FALLBACK:format(quest.id), 1, 1, 1)
	Tooltip.AddQuestLines(GameTooltip, quest.id)
	if quest.done then
		GameTooltip:AddLine(L.JOURNAL_DONE, GREEN[1], GREEN[2], GREEN[3])
	elseif quest.active then
		GameTooltip:AddLine(L.JOURNAL_ACTIVE, YELLOW[1], YELLOW[2], YELLOW[3])
	end
	if quest.x and quest.y then
		GameTooltip:AddLine(L.JOURNAL_CLICK_TRACK, GREY[1], GREY[2], GREY[3], true)
	else
		GameTooltip:AddLine(L.JOURNAL_NO_SPOT, GREY[1], GREY[2], GREY[3], true)
	end
	GameTooltip:Show()
end

local function OnRowClick(row)
	if row.kind == "zone" then
		local state = GetState()
		-- false records an explicit collapse, so opening the journal does not undo it.
		state.expanded[row.zoneID] = state.expanded[row.zoneID] ~= true
		Journal.Render()
	elseif row.kind == "quest" then
		Journal.Track(row.quest.id)
	end
end

local function OnRowEnter(row)
	if row.kind == "quest" then
		ns.SafeCall("journal tooltip", ShowQuestTooltip, row)
	end
end

local function OnRowLeave(row)
	if GameTooltip:IsOwned(row) then
		GameTooltip:Hide()
	end
end

local function CreateRow(list, index)
	local row = CreateFrame("Button", nil, list)
	row:SetHeight(ROW_HEIGHT)
	row:SetPoint("TOPLEFT", 0, -(index - 1) * ROW_HEIGHT)
	row:SetPoint("RIGHT")
	row:RegisterForClicks("LeftButtonUp")

	local highlight = row:CreateTexture(nil, "HIGHLIGHT")
	highlight:SetAllPoints()
	highlight:SetColorTexture(1, 1, 1, 0.08)

	local marker = row:CreateTexture(nil, "ARTWORK")
	marker:SetTexture(Badge.TEXTURE)
	marker:SetSize(MARKER_SIZE, MARKER_SIZE)
	marker:SetPoint("LEFT", 18, 0)
	row.Marker = marker

	local text = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	text:SetPoint("LEFT", 4, 0)
	text:SetPoint("RIGHT", -70, 0)
	text:SetJustifyH("LEFT")
	text:SetWordWrap(false)
	row.Text = text

	local detail = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	detail:SetPoint("RIGHT", -4, 0)
	detail:SetJustifyH("RIGHT")
	row.Detail = detail

	row:SetScript("OnClick", function(self)
		ns.SafeCall("journal click", OnRowClick, self)
	end)
	row:SetScript("OnEnter", OnRowEnter)
	row:SetScript("OnLeave", OnRowLeave)
	return row
end

local function SetColor(fontString, color)
	fontString:SetTextColor(color[1], color[2], color[3])
end

local function ConfigureZone(row, group, expanded)
	row.kind, row.zoneID, row.quest = "zone", group.zoneID, nil
	row.Marker:Hide()
	row.Text:ClearAllPoints()
	row.Text:SetPoint("LEFT", 4, 0)
	row.Text:SetPoint("RIGHT", -70, 0)
	row.Text:SetText((expanded and "- " or "+ ") .. group.name)
	SetColor(row.Text, GOLD)
	row.Detail:SetText(("%d / %d"):format(group.done, group.total))
	SetColor(row.Detail, group.done == group.total and GREEN or WHITE)
end

local function ConfigureQuest(row, quest)
	row.kind, row.zoneID, row.quest = "quest", nil, quest
	local marker = quest.state == State.INFERRED and Display.Marker.INFERRED or Display.Marker.CONFIRMED
	row.Marker:SetTexCoord(Badge.GetTexCoord(marker))
	row.Marker:Show()
	row.Text:ClearAllPoints()
	row.Text:SetPoint("LEFT", row.Marker, "RIGHT", 4, 0)
	row.Text:SetPoint("RIGHT", -70, 0)
	row.Text:SetText(quest.title or L.QUEST_FALLBACK:format(quest.id))
	SetColor(row.Text, quest.done and GREY or WHITE)
	if quest.done then
		row.Detail:SetText(L.JOURNAL_DONE)
		SetColor(row.Detail, GREEN)
	elseif quest.active then
		row.Detail:SetText(L.JOURNAL_ACTIVE)
		SetColor(row.Detail, YELLOW)
	else
		row.Detail:SetText("")
	end
end

local function ConfigureNote(row, text)
	row.kind, row.zoneID, row.quest = "note", nil, nil
	row.Marker:Hide()
	row.Text:ClearAllPoints()
	row.Text:SetPoint("LEFT", 4, 0)
	row.Text:SetPoint("RIGHT", -4, 0)
	row.Text:SetText(text)
	SetColor(row.Text, GREY)
	row.Detail:SetText("")
end

-- Window -------------------------------------------------------------------------

local function CreateJournal()
	local frame = CreateFrame("Frame", FRAME_NAME, UIParent, "BasicFrameTemplateWithInset")
	frame:SetSize(WIDTH, HEIGHT)
	frame:SetPoint("CENTER")
	frame:SetFrameStrata("HIGH")
	frame:SetClampedToScreen(true)
	frame:SetMovable(true)
	frame:EnableMouse(true)
	frame:RegisterForDrag("LeftButton")
	frame:SetScript("OnDragStart", function(self)
		self:StartMoving()
	end)
	frame:SetScript("OnDragStop", function(self)
		self:StopMovingOrSizing()
	end)
	frame.TitleText:SetText(L.JOURNAL_TITLE)

	local summary = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	summary:SetPoint("TOPLEFT", 16, -34)
	summary:SetPoint("RIGHT", -16, 0)
	summary:SetJustifyH("LEFT")
	frame.Summary = summary

	local barBackground = frame:CreateTexture(nil, "ARTWORK")
	barBackground:SetPoint("TOPLEFT", summary, "BOTTOMLEFT", 0, -6)
	barBackground:SetPoint("RIGHT", -16, 0)
	barBackground:SetHeight(BAR_HEIGHT)
	barBackground:SetColorTexture(0, 0, 0, 0.5)
	frame.BarBackground = barBackground

	local barFill = frame:CreateTexture(nil, "OVERLAY")
	barFill:SetPoint("TOPLEFT", barBackground)
	barFill:SetHeight(BAR_HEIGHT)
	barFill:SetColorTexture(GOLD[1], GOLD[2], GOLD[3], 0.8)
	frame.BarFill = barFill

	local hint = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	hint:SetPoint("TOPLEFT", barBackground, "BOTTOMLEFT", 0, -6)
	hint:SetPoint("RIGHT", -16, 0)
	hint:SetJustifyH("LEFT")
	hint:SetText(L.JOURNAL_HINT)
	frame.Hint = hint

	local filter = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
	filter:SetSize(150, 22)
	filter:SetPoint("BOTTOMRIGHT", -12, 10)
	filter:SetScript("OnClick", function()
		local state = GetState()
		state.hideDone = not state.hideDone or nil
		Journal.Render()
	end)
	frame.Filter = filter

	local list = CreateFrame("Frame", nil, frame)
	list:SetPoint("TOPLEFT", 12, LIST_TOP)
	list:SetPoint("BOTTOMRIGHT", -32, LIST_BOTTOM)
	frame.List = list
	for index = 1, NUM_ROWS do
		rows[index] = CreateRow(list, index)
	end

	-- Only the scroll bar and offset are used; the rows live on `list`, because the
	-- faux scroll frame hides itself when everything fits.
	local scroll = CreateFrame("ScrollFrame", nil, frame, "FauxScrollFrameTemplate")
	scroll:SetPoint("TOPLEFT", list)
	scroll:SetPoint("BOTTOMRIGHT", list)
	scroll:SetScript("OnVerticalScroll", function(self, offset)
		FauxScrollFrame_OnVerticalScroll(self, offset, ROW_HEIGHT, Journal.UpdateRows)
	end)
	frame.Scroll = scroll

	frame:SetScript("OnHide", function()
		snapshot = nil
		entries = {}
	end)
	return frame
end

local function BuildEntries(data, state)
	local list = {}
	for _, group in ipairs(data.zones) do
		local expanded = state.expanded[group.zoneID] == true
		table.insert(list, { kind = "zone", group = group, expanded = expanded })
		if expanded then
			for _, quest in ipairs(group.quests) do
				if not (quest.done and state.hideDone) then
					table.insert(list, { kind = "quest", quest = quest })
				end
			end
		end
	end
	if data.unlocated.total > 0 then
		table.insert(list, {
			kind = "note",
			text = L.JOURNAL_UNLOCATED:format(FormatNumber(data.unlocated.total), FormatNumber(data.unlocated.done)),
		})
	end
	if #data.zones == 0 then
		table.insert(list, 1, { kind = "note", text = L.JOURNAL_NO_ZONES })
	end
	return list
end

--- Fills the visible rows from the entries at the current scroll offset.
function Journal.UpdateRows()
	if not window then
		return
	end
	local offset = FauxScrollFrame_GetOffset(window.Scroll)
	for index = 1, NUM_ROWS do
		local row, entry = rows[index], entries[offset + index]
		local hovered = GameTooltip:IsOwned(row)
		if not entry then
			row:Hide()
			if hovered then
				GameTooltip:Hide()
			end
		else
			if entry.kind == "zone" then
				ConfigureZone(row, entry.group, entry.expanded)
			elseif entry.kind == "quest" then
				ConfigureQuest(row, entry.quest)
			else
				ConfigureNote(row, entry.text)
			end
			row:Show()
			-- The hovered row may now show another quest, or no quest at all.
			if hovered and row.kind == "quest" then
				OnRowEnter(row)
			elseif hovered then
				GameTooltip:Hide()
			end
		end
	end
	FauxScrollFrame_Update(window.Scroll, #entries, NUM_ROWS, ROW_HEIGHT)
end

--- Redraws the open journal from the last snapshot.
function Journal.Render()
	if not (window and snapshot) then
		return
	end
	local state = GetState()
	window.Summary:SetText(L.JOURNAL_SUMMARY:format(
		FormatNumber(snapshot.done), FormatNumber(snapshot.total), Percent(snapshot.done, snapshot.total)))
	local fraction = snapshot.total > 0 and snapshot.done / snapshot.total or 0
	local barWidth = window.BarBackground:GetWidth()
	if not barWidth or barWidth <= 0 then
		barWidth = WIDTH - 32
	end
	window.BarFill:SetWidth(math.max(1, barWidth * fraction))
	window.BarFill:SetShown(fraction > 0)
	window.Filter:SetText(state.hideDone and L.JOURNAL_SHOW_DONE or L.JOURNAL_HIDE_DONE)

	entries = BuildEntries(snapshot, state)
	-- Collapsing a zone or hiding completed quests can leave the offset past the end.
	local maxOffset = math.max(0, #entries - NUM_ROWS)
	if FauxScrollFrame_GetOffset(window.Scroll) > maxOffset then
		FauxScrollFrame_OnVerticalScroll(window.Scroll, maxOffset * ROW_HEIGHT, ROW_HEIGHT)
	end
	Journal.UpdateRows()
end

--- Recomputes progress and redraws, if the journal is open.
function Journal.Refresh()
	if not (window and window:IsShown()) then
		return
	end
	snapshot = Progress.Collect()
	Journal.Render()
end

function Journal.Show()
	window = window or CreateJournal()
	snapshot = Progress.Collect()
	local zone = Progress.GetCurrentZone()
	if zone then
		for _, group in ipairs(snapshot.zones) do
			local expanded = GetState().expanded
			if group.zoneID == zone and expanded[zone] == nil then
				expanded[zone] = true
			end
		end
	end
	window:Show()
	Journal.Render()
	return window
end

function Journal.Toggle()
	if window and window:IsShown() then
		window:Hide()
		return
	end
	Journal.Show()
end

function Journal.IsShown()
	return window ~= nil and window:IsShown()
end

--- Sets a waypoint on a quest's pickup spot and says so in chat.
function Journal.Track(questID)
	local ok, reason = Places.Track(questID)
	local title = Progress.GetTitle(questID) or L.QUEST_FALLBACK:format(questID)
	if ok then
		local mapID = Places.GetLocation(questID)
		local _, zone = Places.GetZone(mapID)
		ns:Print(L.TRACK_DONE:format(title, zone))
	elseif reason == "map" then
		ns:Print(L.TRACK_NO_MAP:format(title))
	else
		ns:Print(L.TRACK_UNKNOWN:format(title))
	end
	return ok
end

-- Keeps an open journal current; one redraw per burst of quest events.
local function ScheduleRefresh()
	if refreshPending or not Journal.IsShown() then
		return
	end
	refreshPending = true
	C_Timer.After(REFRESH_DELAY, function()
		refreshPending = false
		ns.SafeCall("journal refresh", Journal.Refresh)
	end)
end

function Journal.Enable()
	for _, event in ipairs({ "QUEST_TURNED_IN", "QUEST_ACCEPTED", "QUEST_REMOVED" }) do
		ns:RegisterEvent(event, ScheduleRefresh)
	end
	ns:RegisterEvent("QUEST_DATA_LOAD_RESULT", function(_, success)
		if success then
			ScheduleRefresh()
		end
	end)
end
