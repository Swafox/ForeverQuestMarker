local ADDON_NAME, ns = ...

local L = ns.L
local DB = ns.DB

-- Settings panel built on the modern Settings API (Game Menu > Options > AddOns).
-- Every checkbox writes straight into ns.db.settings.

local SECTIONS = {
	{
		title = L.OPTIONS_SECTION_DISPLAY,
		keys = { "enabled", "markQuestFrame", "markGossip", "markQuestLog", "markTracker", "tooltips" },
	},
	{
		title = L.OPTIONS_SECTION_STATES,
		keys = { "showInferred", "distinguishInferred", "showChanged", "showSoD", "textTags" },
	},
	{
		title = L.OPTIONS_SECTION_DATA,
		keys = { "recorder", "recordClassic", "chatFallback", "chatAnnounce", "debug" },
	},
}

local category

local function AddCheckbox(key)
	local variable = ADDON_NAME .. "_" .. key
	local setting = Settings.RegisterAddOnSetting(
		category, variable, key, ns.db.settings, Settings.VarType.Boolean,
		L["OPTION_" .. key], DB.DEFAULT_SETTINGS[key]
	)
	setting:SetValueChangedCallback(function(_, value)
		ns:Fire("SETTING_CHANGED", key, value)
	end)
	Settings.CreateCheckbox(category, setting, L["OPTION_" .. key .. "_TIP"])
end

local function AddButton(layout, label, buttonText, tooltip, onClick)
	layout:AddInitializer(CreateSettingsButtonInitializer(label, buttonText, onClick, tooltip, true))
end

function ns.CreateOptions()
	if not (Settings and Settings.RegisterVerticalLayoutCategory) then
		return false
	end
	local layout
	category, layout = Settings.RegisterVerticalLayoutCategory(L.ADDON_TITLE)

	for _, section in ipairs(SECTIONS) do
		layout:AddInitializer(CreateSettingsListSectionHeaderInitializer(section.title))
		for _, key in ipairs(section.keys) do
			AddCheckbox(key)
		end
	end

	layout:AddInitializer(CreateSettingsListSectionHeaderInitializer(L.OPTIONS_SECTION_TOOLS))
	AddButton(layout, L.OPTION_BUTTON_EXPORT_LABEL, L.OPTION_BUTTON_EXPORT, L.OPTION_BUTTON_EXPORT_TIP, function()
		ns.ShowExport("json")
	end)
	AddButton(layout, L.OPTION_BUTTON_STATUS_LABEL, L.OPTION_BUTTON_STATUS, L.OPTION_BUTTON_STATUS_TIP, function()
		ns.Diagnostics.PrintStatus()
	end)

	Settings.RegisterAddOnCategory(category)
	return true
end

function ns.OpenOptions()
	if InCombatLockdown() then
		ns:Print(L.SLASH_COMBAT)
		return
	end
	if category then
		Settings.OpenToCategory(category:GetID())
	end
end
