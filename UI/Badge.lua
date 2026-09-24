local ADDON_NAME, ns = ...

-- The marker art lives in one 128x32 atlas, four 32x32 cells left to right:
-- confirmed (solid), inferred (hollow), changed (half filled), Season of Discovery.

local Badge = {}
ns.Badge = Badge

Badge.TEXTURE = ("Interface\\AddOns\\%s\\Media\\Badges.tga"):format(ADDON_NAME)

local ATLAS_WIDTH, ATLAS_HEIGHT, CELL_SIZE = 128, 32, 32
local CELLS = { confirmed = 0, inferred = 1, changed = 2, sod = 3 }

--- Default marker size and offsets per context. `/fqm tune` stores overrides in
--- ns.db.layout so placement can be adjusted in game without a reload.
Badge.DEFAULT_LAYOUT = {
	-- Inline before quest window titles; y nudges the icon relative to the text baseline.
	title = { size = 16, x = 0, y = 0 },
	-- Pip on the lower right of the quest icon in quest giver lists; the icon's right
	-- edge meets the title text, so the pip stays inside the icon.
	gossip = { size = 11, x = -5, y = 5 },
	greeting = { size = 11, x = -5, y = 5 },
	-- Pip on the quest's POI button in the quest log (or left of the title without one).
	questLog = { size = 12, x = -3, y = 3 },
	-- Pip on the tracked quest's POI button (or in its place without one).
	tracker = { size = 12, x = -3, y = 3 },
}

function Badge.GetLayout(context)
	local defaults = Badge.DEFAULT_LAYOUT[context]
	local overrides = ns.db and ns.db.layout[context]
	if type(overrides) ~= "table" then
		return defaults
	end
	return {
		size = overrides.size or defaults.size,
		x = overrides.x or defaults.x,
		y = overrides.y or defaults.y,
	}
end

function Badge.GetTexCoord(marker)
	local cell = CELLS[marker]
	if not cell then
		return nil
	end
	local left = cell * CELL_SIZE / ATLAS_WIDTH
	return left, left + CELL_SIZE / ATLAS_WIDTH, 0, 1
end

--- Inline texture escape for embedding the marker in text.
function Badge.GetMarkup(marker, size, offsetY)
	local cell = CELLS[marker]
	if not cell then
		return ""
	end
	return ("|T%s:%d:%d:0:%d:%d:%d:%d:%d:0:%d|t"):format(
		Badge.TEXTURE, size, size, offsetY or 0,
		ATLAS_WIDTH, ATLAS_HEIGHT, cell * CELL_SIZE, (cell + 1) * CELL_SIZE, CELL_SIZE
	)
end

--- Pattern matching any inline marker this addon produced.
Badge.MARKUP_PATTERN = "|T[^|]*" .. ADDON_NAME:gsub("%p", "%%%0") .. "[^|]*|t"

local textures = setmetatable({}, { __mode = "k" })
local holders = setmetatable({}, { __mode = "k" })

--- The marker texture this addon attaches to `owner`, created on first use. It lives
--- on a small child frame of our own, so it can be raised above sibling frames such
--- as POI buttons without touching Blizzard's frames. The holder takes no mouse input.
function Badge.Acquire(owner)
	local texture = textures[owner]
	if not texture then
		local holder = CreateFrame("Frame", nil, owner)
		holder:SetPoint("TOPLEFT")
		holder:SetSize(1, 1)
		texture = holder:CreateTexture(nil, "OVERLAY", nil, 7)
		texture:SetTexture(Badge.TEXTURE)
		texture:Hide()
		textures[owner] = texture
		holders[owner] = holder
	end
	return texture
end

--- Draws `owner`'s marker above `frame` (or just above `owner` when frame is nil).
function Badge.SetAbove(owner, frame)
	local holder = holders[owner]
	if holder then
		holder:SetFrameLevel((frame or owner):GetFrameLevel() + 2)
	end
end

function Badge.Apply(texture, marker, size)
	if not marker then
		texture:Hide()
		return
	end
	texture:SetTexCoord(Badge.GetTexCoord(marker))
	texture:SetSize(size, size)
	texture:Show()
end

function Badge.HideOn(owner)
	local texture = textures[owner]
	if texture then
		texture:Hide()
	end
end

function Badge.IsShownOn(owner)
	local texture = textures[owner]
	return texture ~= nil and texture:IsShown()
end
