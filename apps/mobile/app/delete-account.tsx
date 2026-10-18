import { Text } from "react-native";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { getLanguageSync } from "@/lib/language";
export default function DeleteAccountInfo(){
  const tr = useT();
  useEffect(()=>{ if(typeof window!=="undefined") window.location.replace(`/delete-account.html?lang=${getLanguageSync()}`); },[]);
  return <Text style={{padding:20}}>{tr('legal.redirectDeleteAccount')}</Text>;
}
