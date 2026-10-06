import { Linking, Text } from "react-native";
import { useEffect } from "react";
export default function Privacy(){
  useEffect(()=>{ if(typeof window!=="undefined") window.location.replace("/privacy.html"); },[]);
  return <Text style={{padding:20}}>Redirecționare către Politica de confidențialitate...</Text>;
}
