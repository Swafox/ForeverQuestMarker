local ADDON_NAME, ns = ...

-- Saved variables are available on our own ADDON_LOADED; Blizzard frames and the
-- Settings panel are ready by PLAYER_LOGIN, so everything else starts there.

ns:RegisterEvent("ADDON_LOADED", function(addonName)
	if addonName == ADDON_NAME then
		ns.DB.Initialize()
	elseif ns.db then
		ns.Integrations.OnAddOnLoaded(addonName)
	end
end)

ns:RegisterEvent("PLAYER_LOGIN", function()
	if not ns.db then
		ns.DB.Initialize()
	end
	ns.Slash.Register()
	ns.SafeCall("options", ns.CreateOptions)
	ns.Integrations.InstallAll()
	ns.Recorder.Enable()
	ns.EnableNotices()
	ns:On("SETTING_CHANGED", function()
		ns.Integrations.RefreshAll()
	end)
end)
