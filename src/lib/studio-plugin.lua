-- VexBridge 1.4.0. Install ONE copy using Studio > Plugins > Plugins Folder.
local Http = game:GetService("HttpService")
local Editor = game:GetService("ScriptEditorService")
local History = game:GetService("ChangeHistoryService")
local Run = game:GetService("RunService")
local URL = "http://127.0.0.1:__PORT__/roblox"
local TOKEN = "__TOKEN__"
local toolbar = plugin:CreateToolbar("Vex AI")
local button = toolbar:CreateButton("VexBridge", "Open Vex AI Studio panel", "")
local widget = plugin:CreateDockWidgetPluginGuiAsync("VexBridge14", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 420, 720, 320, 420))
widget.Title = "Vex AI • Studio"
local root = Instance.new("ScrollingFrame")
root.Size = UDim2.fromScale(1,1) root.BackgroundColor3 = Color3.fromRGB(22,22,30)
root.AutomaticCanvasSize = Enum.AutomaticSize.Y root.CanvasSize = UDim2.new() root.ScrollBarThickness = 6 root.Parent = widget
local layout = Instance.new("UIListLayout") layout.Padding = UDim.new(0,8) layout.Parent = root
local function field(class, text, height)
 local x = Instance.new(class) x.Size = UDim2.new(1,-12,0,height) x.BackgroundColor3 = Color3.fromRGB(40,39,52)
 x.TextColor3 = Color3.fromRGB(240,235,250) x.TextSize = 14 x.Font = Enum.Font.Code x.Text = text x.TextWrapped = true x.Parent = root
 return x
end
local status = field("TextLabel", "A-Center açık olmalı. Bağlan'a bas ve localhost HTTP iznini ver.", 64)
local connect = field("TextButton", "Bağlan / bağlantıyı kes", 32)
local modelButton = field("TextButton", "Model: modelleri yüklemek için bağlan", 40)
local prompt = field("TextBox", "", 110) prompt.PlaceholderText = "Örn: oyuncuyu takip eden NPC oluştur…" prompt.MultiLine = true prompt.ClearTextOnFocus = false
local npc = field("TextButton", "Örnek: takip eden NPC", 28)
local ui = field("TextButton", "Örnek: oyun arayüzü", 28)
local send = field("TextButton", "Gönder ve görevi başlat", 34)
local summary = field("TextLabel", "Öneriler Studio'da onaylanmadan uygulanmaz.", 48)
field("TextLabel", "Bulut modelinde istek ve mevcut script bağlamı seçilen sağlayıcıya gönderilir.", 48)
local preview = field("TextBox", "Değişiklik önizlemesi", 240) preview.MultiLine = true preview.TextEditable = false preview.ClearTextOnFocus = false preview.TextXAlignment = Enum.TextXAlignment.Left preview.TextYAlignment = Enum.TextYAlignment.Top
preview.AutomaticSize = Enum.AutomaticSize.Y
local approve = field("TextButton", "Öneriyi onayla ve uygula", 32)
local reject = field("TextButton", "Öneriyi reddet", 28)
local undo = field("TextButton", "Son Vex değişikliğini geri al", 28)
local history = field("TextLabel", "Henüz görev yok", 140) history.TextXAlignment = Enum.TextXAlignment.Left history.TextYAlignment = Enum.TextYAlignment.Top
history.AutomaticSize = Enum.AutomaticSize.Y
local cancel = field("TextButton", "Son görevi iptal et", 28)
local connected, generation = false, 0
local models, modelIndex, proposal, lastTask = {}, 1, nil, nil
local backups = {}
local function notify(text) status.Text = tostring(text) print("[VexBridge] " .. tostring(text)) end
local function api(route, method, body)
 local options = {Url=URL..route, Method=method, Headers={["X-Vex-Token"]=TOKEN}}
 if body then options.Headers["Content-Type"]="application/json" options.Body=Http:JSONEncode(body) end
 local ok,res=pcall(function() return Http:RequestAsync(options) end)
 if not ok then return nil,tostring(res) end
 if not res.Success then return nil,"HTTP "..res.StatusCode..": "..res.Body end
 local decoded,data=pcall(function() return Http:JSONDecode(res.Body) end)
 if not decoded then return nil,"Invalid bridge response" end
 return data,nil
end
local function resolve(value)
 if value=="game" then return game end
 local parts=string.split(value,".") if parts[1]=="game" then table.remove(parts,1) end
 local current=game:GetService(parts[1])
 for i=2,#parts do current=current:FindFirstChild(parts[i]) if not current then error("Target path not found: "..value) end end
 return current
end
local function scriptTarget(cmd)
 if cmd.path then return resolve(cmd.path) end
 if cmd.parent then return resolve(cmd.parent):FindFirstChild(cmd.name) end
 local found=nil
 for _,inst in game:GetDescendants() do
  if inst:IsA("LuaSourceContainer") and inst.Name==cmd.name then
   if found then error("Multiple scripts have this name; specify a full path") end found=inst
  end
 end
 return found
end
local function serialize(inst,depth,budget)
 budget.n+=1 if depth>3 or budget.n>250 then return {Name=inst.Name,ClassName=inst.ClassName,truncated=true} end
 local children={} for _,child in inst:GetChildren() do if budget.n>250 then break end table.insert(children,serialize(child,depth+1,budget)) end
 return {Name=inst.Name,ClassName=inst.ClassName,Path=inst:GetFullName(),Children=children}
end
local function execute(cmd)
 if cmd.action=="inspect" then
  local scripts={} local bytes=0
  for _,service in {"Workspace","ServerScriptService","ReplicatedStorage","StarterGui","StarterPlayer"} do
   for _,inst in game:GetService(service):GetDescendants() do
    if inst:IsA("LuaSourceContainer") and #scripts<12 and bytes<24000 then
     local ok,source=pcall(function() return Editor:GetEditorSource(inst) end)
     if ok then local snippet=string.sub(source,1,math.max(0,24000-bytes)) bytes+=#snippet table.insert(scripts,{Path=inst:GetFullName(),Source=snippet,truncated=#snippet<#source}) end
    end
   end
  end
  return {tree=serialize(resolve(cmd.service or "Workspace"),0,{n=0}),scripts=scripts}
 end
 if cmd.action=="read-script" then local inst=scriptTarget(cmd) assert(inst and inst:IsA("LuaSourceContainer"),"Script not found") return {Source=Editor:GetEditorSource(inst),Path=inst:GetFullName()} end
 assert(Run:IsEdit(),"Stop Play mode before changing the place")
 local recording=History:TryBeginRecording("VexBridge","VexBridge") assert(recording,"Another undo recording is active")
 local created=nil
 local changedScript=nil local previousSource=nil
 local ok,result=pcall(function()
  if cmd.action=="write-script" then
   local parent=resolve(cmd.parent or "ServerScriptService") local inst=parent:FindFirstChild(cmd.name)
   if not inst then inst=Instance.new(cmd.className or "Script") created=inst inst.Name=cmd.name inst.Parent=parent end
   assert(inst:IsA("LuaSourceContainer"),"Target must be a script")
   if cmd.className then assert(inst.ClassName==cmd.className,"Existing script has a different class; choose a new name") end
   local before=Editor:GetEditorSource(inst) assert(#before<=128000,"Existing script exceeds backup size limit") backups[inst]=before changedScript=inst previousSource=before
   Editor:UpdateSourceAsync(inst,function() return cmd.source end)
   local actual=Editor:GetEditorSource(inst) assert(actual==cmd.source,"Studio read-back did not match the proposed code")
   return {ok=true,verified=true,Path=inst:GetFullName(),Source=actual,PreviousSource=before,backupAvailable=true}
  elseif cmd.action=="create-instance" then
   local inst=Instance.new(cmd.className or "Part") created=inst inst.Name=cmd.name or cmd.className
   for key,value in pairs(cmd.properties or {}) do inst[key]=value end
   inst.Parent=resolve(cmd.parent or "Workspace") return {ok=true,Path=inst:GetFullName()}
  elseif cmd.action=="set-property" then
   local inst=resolve(cmd.target) assert(cmd.property~="Source" and cmd.property~="Parent","Use an explicit script/creation command") inst[cmd.property]=cmd.value return {ok=true,Path=inst:GetFullName()}
  end error("Unknown Studio action")
 end)
 if not ok and created then created:Destroy() end
 if not ok and changedScript and not created then
  local restored,restoreError=pcall(function() Editor:UpdateSourceAsync(changedScript,function() return previousSource end) end)
  if not restored then result=tostring(result).."; BACKUP RESTORE FAILED: "..tostring(restoreError) end
 end
 History:FinishRecording(recording,ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel)
 if not ok then error(result) end return result
end
local function refresh()
 local data,err=api("/panel","GET") if not data then notify(err) return end
 local selected=models[modelIndex] and models[modelIndex].key models=data.models or {} modelIndex=1
 for i,m in models do if m.key==selected then modelIndex=i end end
 modelButton.Text="Model: "..(models[modelIndex] and models[modelIndex].key or "Model yok; A-Center'da ekle")
 local p=data.proposals and data.proposals[1]
 if p and (not proposal or proposal.id~=p.id) then
  local old="" if p.command=="write-script" then local ok,value=pcall(function() local inst=scriptTarget(p.args) return inst and Editor:GetEditorSource(inst) or "(new script)" end) old=ok and value or tostring(value) end
  preview.Text="COMMAND: "..p.command.."\n"..Http:JSONEncode(p.args).."\nBEFORE:\n"..old.."\nAFTER:\n"..(p.args.source or "")
 end
 proposal=p summary.Text=p and "Tüm kodu incele. Onay, bu değişikliğin Studio'ya uygulanmasına izin verir." or "Bekleyen öneri yok"
 if not p then preview.Text="Bekleyen değişiklik yok. Görev sonucunu ve Studio Output'u kontrol et." end
 local lines={} for i,t in data.tasks or {} do if i<=8 then table.insert(lines,t.title.." • "..t.status..(t.error~="" and "\n"..t.error or "")) end end
 history.Text=table.concat(lines,"\n\n") lastTask=data.tasks and data.tasks[1] and data.tasks[1].id
end
local function poll(run)
 local pending=nil local ticks=0
 while connected and run==generation do
  if pending then local receipt,err=api("/command-result","POST",pending) if receipt then pending=nil elseif string.find(tostring(err),"HTTP 409",1,true) then pending=nil notify("Komut artık sonuç kabul etmiyor. Studio değişikliğini incele; işlem tekrarlanmadı.") else notify("Sonuç teslim edilemedi; işlem tekrarlanmayacak: "..tostring(err)) task.wait(2) continue end end
  local cmd,err=api("/next-command?version=1.4.0","GET")
  if not connected or run~=generation then break end
  if err then notify(err) else
   if ticks==0 then notify("Studio bağlantısı doğrulandı • "..game.Name) end
   if cmd.action then local ok,result=pcall(execute,cmd) pending={id=cmd.id,ok=ok,result=result} if not ok then notify(result) end end
   if ticks%2==0 then refresh() end ticks+=1
  end task.wait(1)
 end
end
button.Click:Connect(function() widget.Enabled=not widget.Enabled end)
connect.MouseButton1Click:Connect(function() connected=not connected generation+=1 button:SetActive(connected) if connected then notify("Bağlanıyor…") task.spawn(poll,generation) else notify("Bağlantı kesildi") end end)
modelButton.MouseButton1Click:Connect(function() if #models>0 then modelIndex=modelIndex%#models+1 modelButton.Text="Model: "..models[modelIndex].key end end)
npc.MouseButton1Click:Connect(function() prompt.Text="ServerScriptService içinde oyuncuyu takip eden ve hasar veren NPC sistemi oluştur. Tüm Luau kodunu yaz." end)
ui.MouseButton1Click:Connect(function() prompt.Text="StarterGui altında can göstergesi arayüzünü oluşturan bir LocalScript ekle." end)
send.MouseButton1Click:Connect(function() if not connected or not models[modelIndex] then notify("Önce bağlan ve model seç") return end local data,err=api("/panel","POST",{action="create",prompt=prompt.Text,model=models[modelIndex].key}) notify(data and "Görev başladı; öneriler hazırlanıyor" or err) end)
local function decide(action) if not proposal then return end local data,err=api("/panel","POST",{action=action,id=proposal.id}) if not data then notify(err) else refresh() end end
approve.MouseButton1Click:Connect(function() decide("approve") end)
reject.MouseButton1Click:Connect(function() decide("reject") end)
undo.MouseButton1Click:Connect(function() local can,name=History:GetCanUndo() if can and name=="VexBridge" then History:Undo() notify("Son Vex değişikliği geri alındı; görevi iptal et veya tekrar incele") else notify("Son işlem VexBridge değil; Studio Undo geçmişini kontrol et") end end)
cancel.MouseButton1Click:Connect(function() if lastTask then local data,err=api("/panel","POST",{action="cancel",id=lastTask}) notify(data and "İptal istendi; teslim edilmiş işlemler için Studio'yu kontrol et" or err) end end)
plugin.Unloading:Connect(function() connected=false generation+=1 end)
