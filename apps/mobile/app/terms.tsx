import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { getLanguageSync } from "@/lib/language";
import { Text } from "react-native";
export default function Terms(){
  const tr = useT();
  useEffect(()=>{ if(typeof window!=="undefined") window.location.replace(`/terms.html?lang=${getLanguageSync()}`); },[]);
  return <Text style={{padding:20}}>{tr('legal.redirectTerms')}</Text>;
}
