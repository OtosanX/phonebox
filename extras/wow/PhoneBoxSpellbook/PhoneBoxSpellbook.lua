local owner = CreateFrame("Frame")
local prefixes = { "CTRL-SHIFT-", "ALT-CTRL-SHIFT-", "ALT-CTRL-", "ALT-SHIFT-" }
local shortcuts = {}
for _, prefix in ipairs(prefixes) do
    for key = 1, 12 do
        if key ~= 4 then shortcuts[#shortcuts + 1] = prefix .. "F" .. key end
    end
    for key = string.byte("A"), string.byte("Z") do
        shortcuts[#shortcuts + 1] = prefix .. string.char(key)
    end
end

local poisonIDs = {
    [3775]=true, [3776]=true, [5237]=true, [6947]=true, [6949]=true, [6950]=true,
    [8926]=true, [8927]=true, [8928]=true, [2892]=true, [2893]=true, [8984]=true,
    [8985]=true, [20844]=true, [10918]=true, [10920]=true, [10921]=true, [10922]=true,
}
local buttons = {}
local formData = PhoneBoxFormData

local function collectActions(class)
    local actions, seen = {}, {}
    local function add(kind, id, name, icon, attr, forms, opens)
        if not name or name == "" or seen[id] then return end
        seen[id] = true
        actions[#actions + 1] = { kind = kind, id = id, name = name, icon = tonumber(icon) or 0,
            attr = attr, forms = forms or "", opens = opens or 0 }
    end
    local bank = Enum.SpellBookSpellBank.Player
    for line = 1, C_SpellBook.GetNumSpellBookSkillLines() do
        local info = C_SpellBook.GetSpellBookSkillLineInfo(line)
        if info and not info.offSpecID and not info.shouldHide then
            for slot = info.itemIndexOffset + 1, info.itemIndexOffset + info.numSpellBookItems do
                local spell = C_SpellBook.GetSpellBookItemInfo(slot, bank)
                if spell and spell.itemType == Enum.SpellBookItemType.Spell and not spell.isPassive
                    and not spell.isOffSpec and not C_SpellBook.IsSpellBookItemLowRank(slot, bank)
                    and spell.name and spell.name ~= "" then
                    local id = spell.spellID or spell.actionID
                    local base = id and C_SpellBook.FindBaseSpellByID(id)
                    add("spell", class .. ":" .. spell.name, spell.name, spell.iconID, nil,
                        formData.requires[id] or formData.requires[base], formData.opens[id] or formData.opens[base])
                end
            end
        end
    end
    if #actions == 0 then return actions end

    local openers = {}
    for _, action in ipairs(actions) do
        if action.opens > 0 then openers[action.opens] = action end
    end
    local function exit(label, id, formIDs, opener, command, destination)
        add("macro", "EXIT:" .. class .. ":" .. id, label, opener.icon,
            { type = "macro", macrotext = command }, formIDs, destination)
    end
    local function cancelAura(form, label, condition, destination)
        local opener = openers[form]
        if opener then
            exit(label, form, tostring(form), opener, "/cancelaura " .. condition .. opener.name, destination)
        end
    end
    if class == "ROGUE" then
        cancelAura(30, "Leave Stealth", "[stealth] ")
    elseif class == "DRUID" then
        cancelAura(30, "Leave Prowl", "[stealth] ", 1)
        local forms, icon = {}, nil
        for _, form in ipairs({ 1, 2, 3, 4, 5, 31 }) do
            if openers[form] then
                forms[#forms + 1] = form
                icon = icon or openers[form]
            end
        end
        if icon then exit("Return to caster form", "caster", table.concat(forms, ","), icon, "/cancelform [form]") end
    elseif class == "WARRIOR" and openers[17] then
        local forms = {}
        for _, form in ipairs({ 18, 19, 24 }) do
            if openers[form] then forms[#forms + 1] = form end
        end
        if #forms > 0 then
            exit("Return to Battle Stance", "battle", table.concat(forms, ","), openers[17], "/cast " .. openers[17].name, 17)
        end
    elseif class == "PRIEST" then
        cancelAura(28, "Leave Shadowform", "")
    elseif class == "SHAMAN" then
        cancelAura(16, "Leave Ghost Wolf", "")
    elseif class == "WARLOCK" then
        cancelAura(22, "Leave Metamorphosis", "")
    end

    for slot = 13, 14 do
        local id = GetInventoryItemID("player", slot)
        if id and C_Item.GetItemSpell(id) then
            add("item", "TRINKET:" .. slot, "Use trinket " .. (slot - 12),
                GetInventoryItemTexture("player", slot), { type = "macro", macrotext = "/use " .. slot })
        end
    end

    local function itemClass(id)
        return select(6, C_Item.GetItemInfoInstant(id))
    end
    local function isFishingRod(id)
        if not id then return false end
        local classID, subClass = itemClass(id)
        return classID == 2 and subClass == 20
    end
    local equipped = GetInventoryItemID("player", 16)
    local rod = isFishingRod(equipped) and equipped or nil
    local hearthstone
    for bag = 0, NUM_BAG_SLOTS do
        for slot = 1, C_Container.GetContainerNumSlots(bag) do
            local id = C_Container.GetContainerItemID(bag, slot)
            if id then
                local name = C_Item.GetItemNameByID(id)
                local icon = C_Item.GetItemIconByID(id)
                local use, useSpell = C_Item.GetItemSpell(id)
                if id == 6948 or not hearthstone and useSpell == 8690 then hearthstone = id end
                if not rod and isFishingRod(id) then rod = id end
                local poison = class == "ROGUE" and (poisonIDs[id] or
                    (GetLocale() == "enUS" and name and name:lower():match(" poison[%sivx]*$")))
                if poison and name then
                    add("poison", "POISON:" .. id .. ":16", name .. " (Main hand)", icon,
                        { type = "item", item = "item:" .. id, ["target-slot"] = 16 })
                    add("poison", "POISON:" .. id .. ":17", name .. " (Off hand)", icon,
                        { type = "item", item = "item:" .. id, ["target-slot"] = 17 })
                elseif name and use and not C_Item.IsEquippableItem(id) then
                    local classID, subClass = itemClass(id)
                    local kind = "item"
                    if classID == 0 and subClass == 5 then kind = "food" end
                    if classID == 0 and subClass == 1 then kind = "potion" end
                    if classID == 15 and subClass == 2 then kind = "pet" end
                    add(kind, "ITEM:" .. id, name, icon, { type = "item", item = "item:" .. id })
                end
            end
        end
    end
    if hearthstone then
        add("item", "ADVENTURE:HEARTHSTONE", "Hearthstone", C_Item.GetItemIconByID(hearthstone),
            { type = "item", item = "item:" .. hearthstone })
    end
    if rod then
        local name
        for _, id in ipairs({1240983, 1240970, 1240959, 1240948, 18248, 7732, 7731, 7620, 131474}) do
            if C_SpellBook.IsSpellKnown(id, bank) then name = C_Spell.GetSpellName(id); break end
        end
        local category = C_Item.GetItemSubClassInfo(2, 20)
        if name and category then
            local text = "/cast [equipped:" .. category .. "] " .. name
                .. "\n/equip [noequipped:" .. category .. "] item:" .. rod
            add("macro", "ADVENTURE:FISHING", "Fishing", C_Item.GetItemIconByID(rod),
                { type = "macro", macrotext = text })
        end
    end

    if UnitExists("pet") then
        local commands = {
            PET_ACTION_ATTACK = { "attack", "Pet attack" },
            PET_ACTION_FOLLOW = { "follow", "Pet follow" },
            PET_ACTION_WAIT = { "stay", "Pet stay" },
            PET_MODE_PASSIVE = { "passive", "Pet passive" },
        }
        for slot = 1, (NUM_PET_ACTION_SLOTS or 10) do
            local name, icon, token = GetPetActionInfo(slot)
            local command = token and commands[name]
            if command then
                local texture = type(icon) == "string" and _G[icon] or icon
                if type(texture) == "string" and GetFileIDFromPath then texture = GetFileIDFromPath(texture) end
                add("pet", "PET:" .. command[1], command[2], texture,
                    { type = "macro", macrotext = "/pet" .. command[1] })
            end
        end
    end

    local general, personal = GetNumMacros()
    local character = UnitName("player")
    local realm = GetRealmName()
    local function macro(index, scope)
        local name, icon = GetMacroInfo(index)
        if name then add("macro", "MACRO:" .. scope .. ":" .. name, name, icon, { type = "macro", macro = index }) end
    end
    for index = 1, general do macro(index, "account") end
    for index = 1, personal do macro((MAX_ACCOUNT_MACROS or 120) + index, realm .. ":" .. character) end
    return actions
end

local function bindAction(action, index, shortcut)
    if not action.attr then
        SetOverrideBindingSpell(owner, false, shortcut, action.name)
        return GetBindingAction(shortcut, true) == "SPELL " .. action.name
    end
    local name = "PhoneBoxAction" .. index
    local button = buttons[index]
    if not button then
        button = CreateFrame("Button", name, owner, "SecureActionButtonTemplate")
        button:RegisterForClicks("AnyDown", "AnyUp")
        buttons[index] = button
    end
    for attribute, value in pairs(action.attr) do button:SetAttribute(attribute, value) end
    SetOverrideBindingClick(owner, false, shortcut, name, "LeftButton")
    return GetBindingAction(shortcut, true) == "CLICK " .. name .. ":LeftButton"
end

local function safe(value)
    return tostring(value):gsub("[%c]", " ")
end

local function update()
    if InCombatLockdown() or not C_SpellBook then return false end
    local className, class = UnitClass("player")
    local character = UnitName("player")
    if not class or not character then return false end
    local actions = collectActions(class)
    if #actions == 0 then return false end

    -- Slots remain reserved even when a different character logs in or a spell is unlearned.
    PhoneBoxSpellbookSlots = PhoneBoxSpellbookSlots or {}
    local slots = PhoneBoxSpellbookSlots
    local taken = {}
    for _, index in pairs(slots) do taken[index] = true end
    ClearOverrideBindings(owner)
    local output = { class, className, character }
    local unavailable = 0
    for _, action in ipairs(actions) do
        local identity = action.id
        local index = slots[identity]
        if not index then
            for candidate, shortcut in ipairs(shortcuts) do
                if not taken[candidate] and (GetBindingAction(shortcut, true) or "") == "" then
                    index = candidate
                    slots[identity] = index
                    taken[index] = true
                    break
                end
            end
        end
        local shortcut = index and shortcuts[index]
        if shortcut and (GetBindingAction(shortcut, true) or "") == "" and bindAction(action, index, shortcut) then
            output[#output + 1] = table.concat({ index, action.kind, safe(identity), action.icon,
                safe(action.name), action.forms, action.opens }, "\t")
        else
            unavailable = unavailable + 1
        end
    end
    for id, name in pairs(formData.names) do
        output[#output + 1] = table.concat({ "form", id, name }, "\t")
    end
    local actionTexture = C_ActionBar and C_ActionBar.GetActionTexture or GetActionTexture
    if actionTexture and C_ActionBar and C_ActionBar.GetActionBarPage then
        local page = C_ActionBar.GetActionBarPage()
        local offset = GetBonusBarOffset and GetBonusBarOffset() or 0
        page = page == 1 and offset > 0 and ((NUM_ACTIONBAR_PAGES or 6) + offset) or page
        for _, key in ipairs({ "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=" }) do
            local binding = GetBindingAction(key, true)
            local slot = binding and tonumber(binding:match("^ACTIONBUTTON(%d+)$"))
            local icon = slot and actionTexture((page - 1) * 12 + slot)
            if type(icon) == "number" then
                output[#output + 1] = table.concat({ "bar", key, icon }, "\t")
            end
        end
    end
    output[#output + 1] = tostring(unavailable)
    PhoneBoxSpellbookExport = "PB3:" .. string.gsub(table.concat(output, "\n"), ".", function(byte)
        return string.format("%02X", string.byte(byte))
    end)
    return true
end

local queued = false
local function refresh()
    if queued then return end
    queued = true
    C_Timer.After(0, function()
        queued = false
        update()
    end)
end

for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "SPELLS_CHANGED", "PLAYER_REGEN_ENABLED", "UPDATE_MACROS", "PLAYER_EQUIPMENT_CHANGED" }) do
    owner:RegisterEvent(event)
end
owner:RegisterUnitEvent("UNIT_PET", "player")
owner:SetScript("OnEvent", refresh)

SLASH_PHONEBOXSPELLBOOK1 = "/pbspells"
SlashCmdList.PHONEBOXSPELLBOOK = function()
    if update() then
        ReloadUI()
    else
        print("PhoneBox: Action sync needs a loaded character outside combat.")
    end
end

-- A small visible indicator that the Windows companion can read. The game controls its
-- active color through the same stealth condition used by native macros.
local _, stealthClass = UnitClass("player")
if (stealthClass == "ROGUE" or stealthClass == "DRUID") and PixelUtil and RegisterStateDriver then
    local indicator = CreateFrame("Frame", nil, UIParent)
    indicator:SetFrameStrata("TOOLTIP")
    local first = indicator:CreateTexture(nil, "ARTWORK")
    local second = indicator:CreateTexture(nil, "ARTWORK")
    local idle = indicator:CreateTexture(nil, "ARTWORK")
    first:SetColorTexture(0.06, 0.82, 0.96, 1)
    second:SetColorTexture(0.78, 0.10, 0.89, 1)
    idle:SetColorTexture(0.98, 0.45, 0.10, 1)
    local active = CreateFrame("Frame", nil, indicator)
    active:SetAllPoints(idle)
    local green = active:CreateTexture(nil, "ARTWORK")
    green:SetAllPoints()
    green:SetColorTexture(0.15, 0.94, 0.24, 1)
    RegisterStateDriver(active, "visibility", "[stealth] show; hide")

    local function layout()
        local scale = indicator:GetEffectiveScale()
        local size = PixelUtil.ConvertPixelsToUI(8, scale)
        indicator:ClearAllPoints()
        indicator:SetPoint("TOPLEFT", UIParent, "TOPLEFT", size / 2, -size / 2)
        indicator:SetSize(size * 3, size)
        for i, texture in ipairs({ first, second, idle }) do
            texture:ClearAllPoints()
            texture:SetPoint("TOPLEFT", indicator, "TOPLEFT", size * (i - 1), 0)
            texture:SetSize(size, size)
        end
    end
    indicator:RegisterEvent("PLAYER_ENTERING_WORLD")
    indicator:RegisterEvent("DISPLAY_SIZE_CHANGED")
    indicator:RegisterEvent("UI_SCALE_CHANGED")
    indicator:RegisterEvent("PLAYER_REGEN_ENABLED")
    indicator:SetScript("OnEvent", function()
        if not InCombatLockdown() then layout() end
    end)
end
