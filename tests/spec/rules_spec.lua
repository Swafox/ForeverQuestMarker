-- Enforces the project rules in AGENTS.md on every file the TOC loads.

local addon = require("helpers.addon")

local metadata, files = addon.ReadToc()

local function Read(path)
	local handle = assert(io.open(path, "rb"))
	local content = handle:read("*a")
	handle:close()
	return content
end

-- Blizzard functions and methods the addon hooks; assigning to them would taint.
local HOOKED = {
	"QuestInfo_Display",
	"QuestFrameGreetingPanel_OnShow",
	"QuestLogQuests_Update",
	"SetItemRef",
}

describe("project rules", function()
	it("targets the WoW Forever interface", function()
		assert.are.equal("16001", metadata.Interface)
		assert.are.equal("@project-version@", metadata.Version)
		assert.are.equal("ForeverQuestMarkerDB", metadata.SavedVariables)
	end)

	it("lists only files that exist, each once", function()
		local seen = {}
		for _, file in ipairs(files) do
			assert.is_nil(seen[file], "listed twice: " .. file)
			seen[file] = true
			assert.is_truthy(io.open(file, "r"), "missing: " .. file)
		end
	end)

	it("ships power-of-two textures that the TOC and code reference", function()
		for _, file in ipairs({ "Media/Badges.tga", "Media/Icon.tga" }) do
			local header = Read(file):sub(1, 18)
			local width = header:byte(13) + header:byte(14) * 256
			local height = header:byte(15) + header:byte(16) * 256
			assert.are.equal(2, header:byte(3), file .. " must be uncompressed true color")
			assert.are.equal(32, header:byte(17), file .. " must be 32 bits per pixel")
			for _, size in ipairs({ width, height }) do
				local isPowerOfTwo = size > 0 and size <= 1024
				while isPowerOfTwo and size > 1 do
					isPowerOfTwo = size % 2 == 0
					size = size / 2
				end
				assert.is_true(isPowerOfTwo, file .. " dimensions must be powers of two up to 1024")
			end
		end
		assert.are.equal("Interface\\AddOns\\ForeverQuestMarker\\Media\\Icon.tga", metadata.IconTexture)
	end)

	for _, file in ipairs(files) do
		describe(file, function()
			local source = Read(file)
			local code = source:gsub("%-%-[^\n]*", "")

			it("uses only ASCII", function()
				assert.is_nil(source:find("[\128-\255]"), "non-ASCII byte found")
			end)

			it("declares the addon namespace", function()
				assert.is_truthy(source:find("local [%w_]+, ns = %.%.%.") or source:find("local _, ns = %.%.%."))
			end)

			it("never polls with OnUpdate", function()
				assert.is_nil(code:find("OnUpdate", 1, true))
			end)

			it("never replaces Blizzard functions", function()
				for _, name in ipairs(HOOKED) do
					assert.is_nil(code:find("[^%w_.\"]" .. name .. "%s*=[^=]"), "assigns " .. name)
					assert.is_nil(code:find("_G%." .. name .. "%s*=[^=]"), "assigns _G." .. name)
				end
				assert.is_nil(code:find("SetItemRef", 1, true), "touches SetItemRef")
			end)

			it("does not use setfenv, getfenv, loadstring or RunScript", function()
				for _, name in ipairs({ "setfenv", "getfenv", "loadstring", "RunScript" }) do
					assert.is_nil(code:find(name .. "%s*%("), "calls " .. name)
				end
			end)
		end)
	end
end)
