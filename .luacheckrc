-- luacheck configuration. The addon runs on WoW's Lua 5.1; every global it reads
-- is listed below so a typo or an accidental global fails the lint.

std = "lua51"
max_line_length = 120
codes = true

exclude_files = {
	".cache/",
	".luarocks/",
	".release/",
	"lua_modules/",
	"node_modules/",
	"worker/",
	"tests/fixtures/",
	"tests/helpers/widget_api.lua",
}

-- Unused `self` in methods and unused loop variables named `_` are fine.
ignore = { "212/self", "212/_.*", "213/_.*" }

-- Globals the addon owns and writes.
globals = {
	"ForeverQuestMarkerDB",
	"SLASH_FOREVERQUESTMARKER1",
	"SLASH_FOREVERQUESTMARKER2",
	SlashCmdList = { fields = { "FOREVERQUESTMARKER" } },
}

-- Client API and FrameXML globals the addon reads (target: WoW Forever, interface 16001).
local WOW_READ_GLOBALS = {
	-- Lua extensions and utilities provided by the client
	"debugstack",
	"geterrorhandler",
	"hooksecurefunc",
	"issecretvalue",
	"strsplit",
	"time",

	-- Namespaced APIs
	"C_AddOns",
	"C_GossipInfo",
	"C_Map",
	"C_QuestLog",
	"C_Timer",
	"Enum",
	"EventRegistry",
	"ScrollUtil",
	"Settings",
	"TooltipDataProcessor",

	-- Global API functions
	"CreateFrame",
	"CreateSettingsButtonInitializer",
	"CreateSettingsListSectionHeaderInitializer",
	"GetActiveQuestID",
	"GetActiveTitle",
	"GetAvailableQuestInfo",
	"GetAvailableTitle",
	"GetBuildInfo",
	"GetLocale",
	"GetNumActiveQuests",
	"GetNumAvailableQuests",
	"GetQuestID",
	"GetTitleText",
	"InCombatLockdown",
	"UnitFactionGroup",
	"UnitGUID",
	"UnitName",

	-- FrameXML frames, functions and constants
	"ChatFontNormal",
	"GameTooltip",
	"GOSSIP_BUTTON_TYPE_ACTIVE_QUEST",
	"GOSSIP_BUTTON_TYPE_AVAILABLE_QUEST",
	"GossipFrame",
	"QuestFrame",
	"QuestFrameGreetingPanel",
	"QuestFrameGreetingPanel_OnShow",
	"QuestFrameProgressPanel",
	"QuestInfo_Display",
	"QuestInfoTitleHeader",
	"QuestLogQuests_Update",
	"QuestObjectiveTracker",
	"QuestProgressTitleText",
	"QuestScrollFrame",
	"UIParent",
}

read_globals = WOW_READ_GLOBALS

-- Generated data tables carry long encoded strings; locale files carry prose.
files["Data/"] = { max_line_length = false }
files["Locales/"] = { max_line_length = false }

-- The client emulation defines the globals above plus the ones the specs drive.
files["tests/"] = {
	std = "+busted",
	read_globals = {
		"QUEST_TEMPLATE_DETAIL",
		"QUEST_TEMPLATE_MAP_DETAILS",
		"QUEST_TEMPLATE_REWARD",
		"GOSSIP_BUTTON_TYPE_OPTION",
		"GOSSIP_BUTTON_TYPE_TITLE",
		"ForeverQuestMarkerExportFrame",
		"ScrollBoxListMixin",
		"SLASH_FOREVERQUESTMARKER1",
	},
}
files["tests/helpers/wow.lua"] = {
	-- The emulation's whole job is defining client globals.
	ignore = { "111", "112", "113", "121", "122", "142", "143" },
}
files["tools/gen-widget-api.lua"] = {
	globals = { "APIDocumentation", "Constants", "Enum" },
}
