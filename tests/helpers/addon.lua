-- Loads the addon the way the client does: every file listed in the TOC, in
-- order, each called with the addon name and the shared namespace table.

local M = {}

M.ADDON_NAME = "ForeverQuestMarker"
M.TOC = "ForeverQuestMarker.toc"

function M.ReadToc(path)
	local metadata, files = {}, {}
	for line in io.lines(path or M.TOC) do
		local key, value = line:match("^##%s*([^:]+):%s*(.-)%s*$")
		if key then
			metadata[key] = value
		elseif line:match("%S") and not line:match("^#") then
			table.insert(files, (line:gsub("%s+$", ""):gsub("\\", "/")))
		end
	end
	return metadata, files
end

--- Loads the given files (default: the whole TOC) into `ns` (default: a new
--- namespace) and returns the namespace.
function M.Load(files, ns)
	ns = ns or {}
	if not files then
		local _
		_, files = M.ReadToc()
	end
	for _, file in ipairs(files) do
		local chunk = assert(loadfile(file))
		chunk(M.ADDON_NAME, ns)
	end
	return ns
end

--- Loads the addon and runs the client's startup events.
function M.Start(env)
	local ns = M.Load()
	env:FireEvent("ADDON_LOADED", M.ADDON_NAME)
	env:FireEvent("PLAYER_LOGIN")
	env:RunTimers()
	return ns
end

return M
