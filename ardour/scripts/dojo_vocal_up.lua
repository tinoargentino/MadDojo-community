ardour { ["type"] = "EditorAction", name = "Dojo: louder guide vocal", license = "MIT" }
function factory() return function()
  local guide = Session:route_by_name("Guide vocal")
  if guide:isnil() then return end
  local gain = guide:gain_control()
  gain:set_value(math.min(1, gain:get_value() + .05), PBD.GroupControlDisposition.NoGroup)
end end
