import { useEffect } from "react";
import { Text } from "react-native";
export default function Terms(){
  useEffect(()=>{ if(typeof window!=="undefined") window.location.replace("/terms.html"); },[]);
  return <Text style={{padding:20}}>Redirecționare către Termeni...</Text>;
}
