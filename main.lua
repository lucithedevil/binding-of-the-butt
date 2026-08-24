-- Binding of the Butt - Main mod with robust error handling
local ButtMod = RegisterMod("Binding of the Butt", 1)
local socket = require("socket")
local json = require("json")

local HOST, PORT = "127.0.0.1", 58711
local client = nil
local connected = false
local reconnectTimer = 0
local RECONNECT_DELAY = 300 -- 10 seconds at 30 FPS
local gameStartTimer = 0
local gameStartSent = false

print("[ButtMod] ============================================")
print("[ButtMod] BINDING OF THE BUTT - STARTUP")
print("[ButtMod] ============================================")

-- Safe connection function
local function Connect()
    local success, err = pcall(function()
        if client then
            pcall(function() client:close() end)
            client = nil
        end
        
        print("[ButtMod] Attempting to connect to companion...")
        client = socket.tcp()
        
        if not client then
            error("Unable to create TCP socket")
        end
        
        client:settimeout(0.1) -- Non-blocking
        local ok, connectErr = client:connect(HOST, PORT)
        
        if not ok then
            if connectErr ~= "timeout" then
                error("Connection failed: " .. tostring(connectErr))
            end
            client:close()
            client = nil
            return false
        end
        
        print("[ButtMod] ✅ Connected to companion!")
        
        -- Send HELLO message
        local helloMsg = json.encode({type = "HELLO", source = "isaac"}) .. "\n"
        local sendOk, sendErr = client:send(helloMsg)
        
        if not sendOk then
            error("HELLO send error: " .. tostring(sendErr))
        end
        
        print("[ButtMod] HELLO message sent")
        connected = true
        return true
    end)
    
    if not success then
        print("[ButtMod] ❌ Connection error: " .. tostring(err))
        connected = false
        if client then
            pcall(function() client:close() end)
            client = nil
        end
        return false
    end
    
    return success
end

-- Safe send function
local function SafeSend(message)
    if not connected or not client then
        return false
    end
    
    local success, err = pcall(function()
        local jsonMsg = json.encode(message) .. "\n"
        local ok, sendErr = client:send(jsonMsg)
        if not ok then
            error("Send error: " .. tostring(sendErr))
        end
    end)
    
    if not success then
        print("[ButtMod] ❌ Message send error: " .. tostring(err))
        connected = false
        return false
    end
    
    return true
end

-- Safe reset function
local function SendReset()
    local success, err = pcall(function()
        if connected and client then
            SafeSend({type = "STOP"})
            print("[ButtMod] STOP signal sent")
        end
    end)
    
    if not success then
        print("[ButtMod] ❌ SendReset error: " .. tostring(err))
    end
end

-- Callback: Game start
function ButtMod:OnGameStart(isContinued)
    local success, err = pcall(function()
        print("[ButtMod] Game started (continued: " .. tostring(isContinued) .. ")")
        Connect()
        gameStartTimer = 30 -- 1 second delay
        gameStartSent = false
    end)
    
    if not success then
        print("[ButtMod] ❌ OnGameStart error: " .. tostring(err))
    end
end
ButtMod:AddCallback(ModCallbacks.MC_POST_GAME_STARTED, ButtMod.OnGameStart)

-- Callback: Update (reconnection handling + low health)
function ButtMod:OnUpdate()
    local success, err = pcall(function()
        -- Reconnection handling
        if not connected then
            reconnectTimer = reconnectTimer + 1
            if reconnectTimer >= RECONNECT_DELAY then
                reconnectTimer = 0
                Connect()
            end
            return
        end
        
        -- Handle GAME_START send after connection
        if gameStartTimer > 0 and not gameStartSent then
            gameStartTimer = gameStartTimer - 1
            if gameStartTimer <= 0 and connected and client then
                SafeSend({
                    type = "GAME_START",
                    continued = false
                })
                print("[ButtMod] GAME_START event sent")
                gameStartSent = true
            end
        end
        
        -- Low health check
        local player = Isaac.GetPlayer(0)
        if not player then
            return
        end
        
        local hearts = player:GetHearts() + player:GetSoulHearts()
        if hearts <= 2 then -- 1 heart or less
            SafeSend({type = "HEART_LOW", hearts = hearts})
        end
    end)
    
    if not success then
        print("[ButtMod] ❌ OnUpdate error: " .. tostring(err))
    end
end
ButtMod:AddCallback(ModCallbacks.MC_POST_UPDATE, ButtMod.OnUpdate)

-- Callback: Collectible picked up
function ButtMod:OnCollectibleInit(pickup)
    local success, err = pcall(function()
        if not pickup then
            return
        end
        
        local itemConfig = Isaac.GetItemConfig()
        if not itemConfig then
            return
        end
        
        local cfg = itemConfig:GetCollectible(pickup.SubType)
        if not cfg or not cfg.Quality then
            return
        end
        
        if cfg.Quality >= 3 then -- Quality 3 or 4
            SafeSend({
                type = "ITEM_QUALITY",
                quality = cfg.Quality,
                name = cfg.Name or "Unknown"
            })
            print("[ButtMod] Quality " .. cfg.Quality .. " item detected: " .. (cfg.Name or "Unknown"))
        end
    end)
    
    if not success then
        print("[ButtMod] ❌ OnCollectibleInit error: " .. tostring(err))
    end
end
ButtMod:AddCallback(ModCallbacks.MC_POST_PICKUP_INIT, ButtMod.OnCollectibleInit, PickupVariant.PICKUP_COLLECTIBLE)

-- Callback: Player hurt
function ButtMod:OnPlayerHurt(ent, amount, flags, source, countdown)
    local success, err = pcall(function()
        if not ent or not connected or not client then
            return
        end
        
        SafeSend({
            type = "PLAYER_HURT",
            damage = amount or 1,
            source = source and source.Type or "unknown"
        })
        print("[ButtMod] Player hurt - damage: " .. (amount or 1))
    end)
    
    if not success then
        print("[ButtMod] ❌ OnPlayerHurt error: " .. tostring(err))
    end
end
ButtMod:AddCallback(ModCallbacks.MC_ENTITY_TAKE_DMG, ButtMod.OnPlayerHurt, EntityType.ENTITY_PLAYER)

-- Callback: NPC death (boss or enemy)
function ButtMod:OnNPCDeath(npc)
    local success, err = pcall(function()
        if not npc or not connected or not client then
            return
        end
        
        -- Check whether it is a boss
        if npc:IsBoss() then
            SafeSend({
                type = "BOSS_DEATH",
                boss = npc.Type or "unknown"
            })
            print("[ButtMod] Boss defeated: " .. (npc.Type or "unknown"))
        else
            -- Special enemies (larger boost)
            if npc.Type == EntityType.ENTITY_MONSTRO or 
               npc.Type == EntityType.ENTITY_LARRY_JR or
               npc.Type == EntityType.ENTITY_CHUB then
                SafeSend({
                    type = "SPECIAL_ENEMY_DEATH",
                    enemy = npc.Type
                })
                print("[ButtMod] Special enemy defeated: " .. npc.Type)
            else
                -- Normal enemy (small boost)
                SafeSend({
                    type = "ENEMY_DEATH",
                    enemy = npc.Type or "unknown"
                })
                -- No log to avoid spam
            end
        end
    end)
    
    if not success then
        print("[ButtMod] ❌ OnNPCDeath error: " .. tostring(err))
    end
end
ButtMod:AddCallback(ModCallbacks.MC_POST_NPC_DEATH, ButtMod.OnNPCDeath)

-- Callback: Game exit
function ButtMod:OnExit()
    print("[ButtMod] Game exit - cleanup...")
    SendReset()
    if client then
        pcall(function() client:close() end)
        client = nil
    end
    connected = false
end
ButtMod:AddCallback(ModCallbacks.MC_PRE_GAME_EXIT, ButtMod.OnExit)

print("[ButtMod] Mod initialized - waiting for companion connection")
print("[ButtMod] Make sure companion.js is running!")

-- Initial connection attempt
Connect()