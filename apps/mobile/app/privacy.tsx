import { Linking, Text } from "react-native";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { getLanguageSync } from "@/lib/language";
export default function Privacy(){
  const tr = useT();
  useEffect(()=>{ if(typeof window!=="undefined") window.location.replace(`/privacy.html?lang=${getLanguageSync()}`); },[]);
  return <Text style={{padding:20}}>{tr('legal.redirectPrivacy')}</Text>;
}
