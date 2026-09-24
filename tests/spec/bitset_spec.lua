local wow = require("helpers.wow")
local addon = require("helpers.addon")

local SETS = { "classic", "datamined", "community", "changed", "sod", "era" }
local SCAN_LIMIT = 110000

describe("Bitset", function()
	local ns

	before_each(function()
		wow.Create()
		ns = addon.Load({
			"Locales/Locales.lua",
			"Locales/enUS.lua",
			"Core/Init.lua",
			"Core/Bitset.lua",
		})
	end)

	it("finds segment members and loose IDs", function()
		-- "B" = 1 (only offset + 0), "g" = 32 (only offset + 5), "/" = 63 (six in a row)
		local set = ns.Bitset.New({ count = 9, segments = { { 100, "Bg/" } }, ids = { 7, 90000 } })
		for _, id in ipairs({ 7, 90000, 100, 111, 112, 113, 114, 115, 116, 117 }) do
			assert.is_true(set:Contains(id), "expected " .. id)
		end
		for _, id in ipairs({ 1, 6, 8, 99, 101, 106, 110, 118, 89999, 90001 }) do
			assert.is_false(set:Contains(id), "did not expect " .. id)
		end
	end)

	it("treats an empty spec as an empty set", function()
		local set = ns.Bitset.New({})
		assert.is_false(set:Contains(1))
		assert.are.equal(0, set:GetCount())
	end)

	describe("generated data", function()
		local fixtures = dofile("tests/fixtures/quest_sets.lua")

		before_each(function()
			addon.Load({ "Data/Meta.lua", "Data/ClassicQuests.lua", "Data/ForeverQuests.lua", "Data/Exclusions.lua" }, ns)
		end)

		for _, name in ipairs(SETS) do
			it("decodes the " .. name .. " set exactly", function()
				local spec = assert(ns.Data.Sets[name], "missing set " .. name)
				local set = ns.Bitset.New(spec)
				local expected = {}
				for _, id in ipairs(fixtures[name]) do
					expected[id] = true
				end
				assert.are.equal(#fixtures[name], spec.count)
				assert.are.equal(#fixtures[name], ns.Data.meta.counts[name])
				local mismatches = {}
				for id = 1, SCAN_LIMIT do
					if set:Contains(id) ~= (expected[id] == true) then
						table.insert(mismatches, id)
						if #mismatches >= 10 then
							break
						end
					end
				end
				assert.are.same({}, mismatches)
			end)
		end
	end)
end)
