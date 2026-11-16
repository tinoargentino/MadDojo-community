ardour { ["type"] = "EditorAction", name = "Dojo: quieter guide vocal", license = "MIT" }
function factory() return function()
  local guide = Session:route_by_name("Guide vocal")
  if guide:isnil() then return end
  local gain = guide:gain_control()
  gain:set_value(math.max(0, gain:get_value() - .05), PBD.GroupControlDisposition.NoGroup)
end end
