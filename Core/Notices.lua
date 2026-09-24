local _, ns = ...

local L = ns.L
local Display = ns.Display
local Badge = ns.Badge
local DB = ns.DB

-- Chat notices for offered quests. They cover players who replaced the quest window
-- with another addon (Immersion and similar), where no badge can be drawn, and
-- players who simply want an announcement.

local CHECK_DELAY = 0.2
local announced = {}

local function QuestWindowIsShown()
	return QuestFrame ~= nil and QuestFrame:IsShown()
end

local function Announce(questID, title)
	if announced[questID] then
		return
	end
	local marker = Display.GetMarker(questID)
	if not marker then
		return
	end
	announced[questID] = true
	local state = ns.Classifier.Classify(questID)
	local label = Badge.GetMarkup(marker, 14) .. " " .. Display.GetStateText(state)
	ns:Print(L.NOTICE_QUEST:format(title or ("#" .. questID), label))
end

local function OnQuestDetail()
	local questID = GetQuestID()
	if not questID or questID <= 0 then
		return
	end
	local title = GetTitleText()
	if DB.GetSetting("chatAnnounce") then
		Announce(questID, title)
		return
	end
	if not DB.GetSetting("chatFallback") then
		return
	end
	-- Give the quest window (or its replacement) a moment to appear.
	C_Timer.After(CHECK_DELAY, function()
		if not QuestWindowIsShown() then
			ns.SafeCall("quest notice", Announce, questID, title)
		end
	end)
end

function ns.EnableNotices()
	ns:RegisterEvent("QUEST_DETAIL", OnQuestDetail)
end
