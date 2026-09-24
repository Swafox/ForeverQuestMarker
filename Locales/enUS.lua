local _, ns = ...

local L = ns.L

L.ADDON_TITLE = "ForeverQuest Marker"

-- Quest states, as shown in tooltips.
L.STATE_CONFIRMED = "New in WoW Forever"
L.STATE_INFERRED = "Likely new in WoW Forever"
L.STATE_CHANGED = "Classic quest, modified in Forever"
L.STATE_SOD = "Season of Discovery quest"
L.STATE_ERA = "Classic Era quest"
L.STATE_CLASSIC = "Original Classic quest"
L.STATE_UNKNOWN = "Unknown quest"

L.STATE_CONFIRMED_NOTE = "Confirmed from Forever client data or player reports."
L.STATE_INFERRED_NOTE = "Not in the Classic quest database. Not yet confirmed."
L.STATE_CHANGED_NOTE = "Players reported changes to this quest in Forever."
L.STATE_SOD_NOTE = "Not original Classic; it first appeared in Season of Discovery."

-- Short tags for the "show state as text" option.
L.TAG_CONFIRMED = "New"
L.TAG_INFERRED = "New?"
L.TAG_CHANGED = "Changed"
L.TAG_SOD = "SoD"

-- Why a quest received its state; used by /fqm check.
L.REASON_CHANGED = "reported as modified in Forever"
L.REASON_CLASSIC = "listed in the Classic quest database"
L.REASON_COMMUNITY = "confirmed as new by player reports"
L.REASON_DATAMINED = "present in the Forever client data but not in Classic Era"
L.REASON_SOD = "listed in the Season of Discovery quest database"
L.REASON_ERA = "present in the Classic Era client data"
L.REASON_UNLISTED = "not in any Classic, Season of Discovery or Classic Era data"
L.REASON_INVALID = "not a valid quest ID"

-- Chat notices.
L.NOTICE_QUEST = "%s: %s"
L.ERROR_NOTICE = "hit an error in %s. Details: /fqm errors"

-- Settings panel.
L.OPTIONS_SECTION_DISPLAY = "Where to mark quests"
L.OPTIONS_SECTION_STATES = "What to mark"
L.OPTIONS_SECTION_DATA = "Data collection"
L.OPTIONS_SECTION_TOOLS = "Tools"

L.OPTION_enabled = "Enable quest markers"
L.OPTION_enabled_TIP = "Master switch for every badge and tooltip line this addon adds."
L.OPTION_markQuestFrame = "Quest window titles"
L.OPTION_markQuestFrame_TIP = "Mark the quest title when a quest giver offers, checks or completes a quest, and in quest details."
L.OPTION_markGossip = "Quest giver lists"
L.OPTION_markGossip_TIP = "Mark quests listed in quest giver dialogs."
L.OPTION_markQuestLog = "Quest log"
L.OPTION_markQuestLog_TIP = "Mark quests in the quest log."
L.OPTION_markTracker = "Objective tracker"
L.OPTION_markTracker_TIP = "Mark tracked quests in the objective tracker."
L.OPTION_tooltips = "Tooltips"
L.OPTION_tooltips_TIP = "Explain the marker in tooltips, including quest links in chat."
L.OPTION_showInferred = "Likely new quests"
L.OPTION_showInferred_TIP = "Mark quests that are missing from the Classic quest database but not yet confirmed as new."
L.OPTION_distinguishInferred = "Distinguish likely from confirmed"
L.OPTION_distinguishInferred_TIP = "Show likely new quests with a hollow marker. When off they use the confirmed marker."
L.OPTION_showChanged = "Changed Classic quests"
L.OPTION_showChanged_TIP = "Mark original Classic quests that players reported as modified in Forever."
L.OPTION_showSoD = "Season of Discovery quests"
L.OPTION_showSoD_TIP = "Mark quests that first appeared in Season of Discovery rather than original Classic."
L.OPTION_textTags = "Show state as text"
L.OPTION_textTags_TIP = "Add a short word such as New or Changed next to marked quest titles, for readability without relying on the marker shape."
L.OPTION_recorder = "Record quests for the community list"
L.OPTION_recorder_TIP = "Remember quests that are not original Classic so you can share them with /fqm export. Stored only in your SavedVariables."
L.OPTION_recordClassic = "Record Classic quests for change detection"
L.OPTION_recordClassic_TIP = "Also remember original Classic quests you see, so exported data can reveal quests that Forever modified."
L.OPTION_chatFallback = "Chat notice when the quest window is replaced"
L.OPTION_chatFallback_TIP = "If another addon replaces the quest window, print the quest's state in chat instead."
L.OPTION_chatAnnounce = "Always announce new quests in chat"
L.OPTION_chatAnnounce_TIP = "Print a chat line whenever a quest giver offers a quest that is not original Classic."
L.OPTION_debug = "Debug messages"
L.OPTION_debug_TIP = "Print diagnostic messages to chat. Useful when reporting problems."
L.OPTION_BUTTON_EXPORT = "Export"
L.OPTION_BUTTON_EXPORT_LABEL = "Export recorded quests"
L.OPTION_BUTTON_EXPORT_TIP = "Open a window with your recorded quests, ready to copy and share."
L.OPTION_BUTTON_STATUS = "Print"
L.OPTION_BUTTON_STATUS_LABEL = "Print status to chat"
L.OPTION_BUTTON_STATUS_TIP = "Show data versions, which frames are marked, and recorded quest counts."

-- Export window.
L.EXPORT_TITLE = "ForeverQuest Marker Export"
L.EXPORT_HINT = "Press Ctrl+A then Ctrl+C to copy. Paste it on the submission page or share it with the addon author."
L.EXPORT_HINT_URL = "Press Ctrl+A then Ctrl+C to copy, then paste it at %s"
L.EXPORT_EMPTY = "No quests recorded yet. Talk to quest givers with the recorder enabled, then try again."
L.EXPORT_SUMMARY = "%d quests (%s)"

-- Slash command output.
L.SLASH_HELP = {
	"/fqm - open the settings",
	"/fqm check <questID> - explain how a quest is classified",
	"/fqm export [csv] - copy your recorded quests",
	"/fqm status - data versions, marked frames and recorder counts",
	"/fqm probe - list the quests the addon sees in open windows",
	"/fqm errors - show errors the addon caught",
	"/fqm debug - toggle debug messages",
	"/fqm tune <context> <size|x|y> <value> - adjust marker placement",
	"/fqm reset recorder - delete recorded quests",
}
L.SLASH_UNKNOWN = "Unknown command '%s'. Type /fqm help."
L.SLASH_CHECK_USAGE = "Usage: /fqm check <questID>"
L.SLASH_CHECK_RESULT = "Quest %d%s: %s (%s)"
L.SLASH_DEBUG = "Debug messages %s."
L.SLASH_ON = "on"
L.SLASH_OFF = "off"
L.SLASH_RESET_DONE = "Deleted %d recorded quests."
L.SLASH_RESET_CONFIRM = "Type /fqm reset recorder confirm to delete %d recorded quests."
L.SLASH_NO_ERRORS = "No errors recorded."
L.SLASH_TUNE_USAGE = "Usage: /fqm tune <context> <size|x|y> <number>, or /fqm tune reset. Contexts: %s"
L.SLASH_TUNE_DONE = "%s %s set to %s."
L.SLASH_TUNE_RESET = "Marker placement reset to defaults."
L.SLASH_COMBAT = "Not available in combat."
