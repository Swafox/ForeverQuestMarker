local _, ns = ...

local State = ns.State

local Classifier = {}
ns.Classifier = Classifier

-- Evaluated in order; the first set containing the quest decides its state.
-- "changed" precedes "classic" because changed quests are original Classic IDs.
-- The generator already keeps Classic IDs out of the new-quest sets, so the
-- order of the remaining rules only matters as a safety net.
local RULES = {
	{ set = "changed", state = State.CHANGED, reason = "changed" },
	{ set = "classic", state = State.CLASSIC, reason = "classic" },
	{ set = "community", state = State.CONFIRMED, reason = "community" },
	{ set = "datamined", state = State.CONFIRMED, reason = "datamined" },
	{ set = "sod", state = State.SOD, reason = "sod" },
	{ set = "era", state = State.ERA, reason = "era" },
}

local sets
local stateCache = {}
local reasonCache = {}

local function LoadSets()
	sets = {}
	for _, rule in ipairs(RULES) do
		local spec = ns.Data.Sets[rule.set]
		sets[rule.set] = ns.Bitset.New(spec or {})
	end
end

local function IsValidQuestID(questID)
	return type(questID) == "number" and questID > 0 and questID == math.floor(questID)
end

--- Returns the state of a quest ID and the reason key behind it.
--- Quests missing from every known list are inferred to be new in Forever.
function Classifier.Classify(questID)
	if not IsValidQuestID(questID) then
		return State.UNKNOWN, "invalid"
	end
	local cached = stateCache[questID]
	if cached then
		return cached, reasonCache[questID]
	end
	if not sets then
		LoadSets()
	end

	local state, reason = State.INFERRED, "unlisted"
	for _, rule in ipairs(RULES) do
		if sets[rule.set]:Contains(questID) then
			state, reason = rule.state, rule.reason
			break
		end
	end

	stateCache[questID] = state
	reasonCache[questID] = reason
	return state, reason
end

--- True for states that mean "not an original Classic quest".
function Classifier.IsNotClassic(state)
	return state == State.CONFIRMED or state == State.INFERRED or state == State.SOD
end

function Classifier.GetSetCount(name)
	if not sets then
		LoadSets()
	end
	return sets[name] and sets[name]:GetCount() or 0
end

--- Drops cached results, for example after data tables change in tests.
function Classifier.Reset()
	sets = nil
	stateCache = {}
	reasonCache = {}
end
