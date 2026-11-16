ardour { ["type"] = "EditorAction", name = "Dojo: guide vocal on/off", license = "MIT",
  description = "Toggle the guide without changing your selected recording track." }
function factory() return function()
  local guide = Session:route_by_name("Guide vocal")
  if guide:isnil() then return end
  local mute = guide:mute_control()
  mute:set_value(mute:get_value() > .5 and 0 or 1, PBD.GroupControlDisposition.NoGroup)
end end
