local _, ns = ...

local L = ns.L
local State = ns.State
local Classifier = ns.Classifier
local DB = ns.DB

-- Decides what, if anything, to show for a quest. UI modules ask here instead of
-- reading settings themselves so every frame follows the same rules.

local Display = {}
ns.Display = Display

--- Marker styles; each one is a cell of Media/Badges.tga.
Display.Marker = {
	CONFIRMED = "confirmed",
	INFERRED = "inferred",
	CHANGED = "changed",
	SOD = "sod",
}
local Marker = Display.Marker

Display.COLORS = {
	confirmed = { 0.902, 0.753, 0.404 },
	inferred = { 0.902, 0.753, 0.404 },
	changed = { 0.561, 0.702, 0.878 },
	sod = { 0.706, 0.549, 0.902 },
}

local TAGS = {
	confirmed = L.TAG_CONFIRMED,
	inferred = L.TAG_INFERRED,
	changed = L.TAG_CHANGED,
	sod = L.TAG_SOD,
}

local STATE_TEXT = {
	[State.CONFIRMED] = L.STATE_CONFIRMED,
	[State.INFERRED] = L.STATE_INFERRED,
	[State.CHANGED] = L.STATE_CHANGED,
	[State.SOD] = L.STATE_SOD,
	[State.ERA] = L.STATE_ERA,
	[State.CLASSIC] = L.STATE_CLASSIC,
	[State.UNKNOWN] = L.STATE_UNKNOWN,
}

local STATE_NOTE = {
	[State.CONFIRMED] = L.STATE_CONFIRMED_NOTE,
	[State.INFERRED] = L.STATE_INFERRED_NOTE,
	[State.CHANGED] = L.STATE_CHANGED_NOTE,
	[State.SOD] = L.STATE_SOD_NOTE,
}

local REASON_TEXT = {
	changed = L.REASON_CHANGED,
	classic = L.REASON_CLASSIC,
	community = L.REASON_COMMUNITY,
	datamined = L.REASON_DATAMINED,
	sod = L.REASON_SOD,
	era = L.REASON_ERA,
	unlisted = L.REASON_UNLISTED,
	invalid = L.REASON_INVALID,
}

--- Returns the marker style for a quest, or nil when nothing should be shown.
--- `contextSetting` is the setting that controls the calling frame, if any.
function Display.GetMarker(questID, contextSetting)
	if not DB.GetSetting("enabled") then
		return nil
	end
	if contextSetting and not DB.GetSetting(contextSetting) then
		return nil
	end

	local state = Classifier.Classify(questID)
	if state == State.CONFIRMED then
		return Marker.CONFIRMED
	elseif state == State.INFERRED then
		if not DB.GetSetting("showInferred") then
			return nil
		end
		return DB.GetSetting("distinguishInferred") and Marker.INFERRED or Marker.CONFIRMED
	elseif state == State.CHANGED then
		return DB.GetSetting("showChanged") and Marker.CHANGED or nil
	elseif state == State.SOD then
		return DB.GetSetting("showSoD") and Marker.SOD or nil
	end
	return nil
end

--- Short colored word for a marker, used when "Show state as text" is on.
function Display.GetTag(marker)
	local color = Display.COLORS[marker]
	local text = TAGS[marker]
	if not color or not text then
		return ""
	end
	local function Byte(channel)
		return math.floor(channel * 255 + 0.5)
	end
	return ("|cff%02x%02x%02x%s|r"):format(Byte(color[1]), Byte(color[2]), Byte(color[3]), text)
end

function Display.GetStateText(state)
	return STATE_TEXT[state] or STATE_TEXT[State.UNKNOWN]
end

function Display.GetReasonText(reason)
	return REASON_TEXT[reason] or reason
end

--- Lines explaining a quest's state for tooltips, or nil when the quest is
--- original Classic or tooltips are off. Returns headline, note, r, g, b.
function Display.GetTooltipInfo(questID)
	local marker = Display.GetMarker(questID, "tooltips")
	if not marker then
		return nil
	end
	local state = Classifier.Classify(questID)
	local color = Display.COLORS[marker]
	return STATE_TEXT[state], STATE_NOTE[state], color[1], color[2], color[3]
end
