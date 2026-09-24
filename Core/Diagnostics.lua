local _, ns = ...

local Classifier = ns.Classifier
local Display = ns.Display
local Badge = ns.Badge

-- Chat reports that make in-game verification quick: /fqm status, probe and errors.

local Diagnostics = {}
ns.Diagnostics = Diagnostics

local SET_ORDER = { "classic", "datamined", "community", "changed", "sod", "era" }

local function Describe(questID)
	local state, reason = Classifier.Classify(questID)
	local marker = Display.GetMarker(questID)
	return ("%s [%s, %s]"):format(state, Display.GetReasonText(reason), marker and ("marker " .. marker) or "no marker")
end

function Diagnostics.PrintStatus()
	local version, build, _, interface = GetBuildInfo()
	local meta = ns.Data.meta or {}
	ns:Print(("%s on %s.%s (interface %s), locale %s"):format(ns:GetVersion(), version, build, interface, GetLocale()))
	ns:Print(("Data: %s, Forever client %s, Classic Era client %s"):format(
		meta.questieDB or "?", meta.foreverBuild or "?", meta.eraBuild or "?"))
	if meta.foreverBuild and meta.foreverBuild ~= ("%s.%s"):format(version, build) then
		ns:Print("|cffff8040Note:|r this client build differs from the build the new-quest list was mined from.")
	end

	local counts = {}
	for _, name in ipairs(SET_ORDER) do
		table.insert(counts, ("%s %d"):format(name, Classifier.GetSetCount(name)))
	end
	ns:Print("Sets: " .. table.concat(counts, ", "))

	local integrations = {}
	for _, spec in ipairs(ns.Integrations.List()) do
		local color = spec.status == "installed" and "ff40c040" or "ffff6060"
		local entry = ("|c%s%s %s|r"):format(color, spec.key, spec.status)
		if spec.detail then
			entry = entry .. " (" .. spec.detail .. ")"
		end
		table.insert(integrations, entry)
	end
	ns:Print("Integrations: " .. table.concat(integrations, ", "))

	local byState = {}
	for state, count in pairs(ns.Recorder.CountByState()) do
		table.insert(byState, ("%s %d"):format(state, count))
	end
	table.sort(byState)
	ns:Print(("Recorder %s: %d quests%s"):format(
		ns.DB.GetSetting("recorder") and "on" or "off",
		ns.Recorder.Count(),
		#byState > 0 and (" (" .. table.concat(byState, ", ") .. ")") or ""))
	ns:Print(("Errors stored: %d"):format(#ns.db.errors))
end

function Diagnostics.PrintCheck(questID)
	local title = C_QuestLog.GetTitleForQuestID(questID)
	if not title then
		-- Ask the server so a second /fqm check can show the title.
		C_QuestLog.RequestLoadQuestByID(questID)
	end
	local state, reason = Classifier.Classify(questID)
	ns:Print(ns.L.SLASH_CHECK_RESULT:format(
		questID, title and (" " .. title) or "", Display.GetStateText(state), Display.GetReasonText(reason)))
end

local function ProbeGossip(lines)
	if not (GossipFrame and GossipFrame:IsShown()) then
		return
	end
	local scrollBox = GossipFrame.GreetingPanel and GossipFrame.GreetingPanel.ScrollBox
	if not scrollBox then
		table.insert(lines, "Gossip: ScrollBox not found")
		return
	end
	scrollBox:ForEachFrame(function(frame, elementData)
		local info = type(elementData) == "table" and elementData.info
		if type(info) == "table" and info.questID then
			table.insert(lines, ("Gossip %d %s: %s, badge %s"):format(
				info.questID, info.title or "", Describe(info.questID), Badge.IsShownOn(frame) and "shown" or "hidden"))
		end
	end)
end

local function ProbeGreeting(lines)
	local panel = QuestFrameGreetingPanel
	if not (panel and panel:IsShown() and panel.titleButtonPool) then
		return
	end
	for button in panel.titleButtonPool:EnumerateActive() do
		local questID = ns.GetRowQuest(button)
		table.insert(lines, ("Greeting row %d (%s): %s"):format(
			button:GetID(), button.isActive == 1 and "active" or "available",
			questID and Describe(questID) or "not marked"))
	end
end

local function ProbeQuestWindow(lines)
	if not (QuestFrame and QuestFrame:IsShown()) then
		return
	end
	local questID = GetQuestID()
	table.insert(lines, ("Quest window %d %s: %s"):format(questID or 0, GetTitleText() or "", Describe(questID)))
	if QuestInfoTitleHeader then
		table.insert(lines, "Title text: " .. (QuestInfoTitleHeader:GetText() or ""):gsub("|", "||"))
	end
end

local function ProbeQuestLog(lines)
	local pool = QuestScrollFrame and QuestScrollFrame.titleFramePool
	if not (pool and QuestScrollFrame:IsVisible()) then
		return
	end
	local total, marked = 0, 0
	for button in pool:EnumerateActive() do
		total = total + 1
		if Badge.IsShownOn(button) then
			marked = marked + 1
		end
	end
	table.insert(lines, ("Quest log: %d quest rows, %d marked"):format(total, marked))
end

local function ProbeTracker(lines)
	local module = QuestObjectiveTracker
	if not (module and module.EnumerateActiveBlocks) then
		return
	end
	local total, marked = 0, 0
	module:EnumerateActiveBlocks(function(block)
		if block.HeaderText then
			total = total + 1
			if Badge.IsShownOn(block) then
				marked = marked + 1
			end
		end
	end)
	table.insert(lines, ("Tracker: %d quest blocks, %d marked"):format(total, marked))
end

--- Lists what the addon sees in the windows that are open right now.
function Diagnostics.PrintProbe()
	local lines = {}
	ProbeQuestWindow(lines)
	ProbeGreeting(lines)
	ProbeGossip(lines)
	ProbeQuestLog(lines)
	ProbeTracker(lines)
	if #lines == 0 then
		table.insert(lines, "Nothing to probe. Open a quest giver, the quest log or the tracker first.")
	end
	for _, line in ipairs(lines) do
		ns:Print(line)
	end
end

function Diagnostics.PrintErrors()
	local errors = ns.db.errors
	if #errors == 0 then
		ns:Print(ns.L.SLASH_NO_ERRORS)
		return
	end
	for i, entry in ipairs(errors) do
		ns:Print(("%d. [%s] x%d %s"):format(i, entry.context, entry.count or 1, entry.message))
	end
	ns:Print("Full stacks are in the ForeverQuestMarkerDB saved variables file after a /reload.")
end
