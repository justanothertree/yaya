-- ROLLBACK for docs/applied/2026-11-22-circuit-creator-staple.DRAFT.sql. ⛔ Not applied, like the draft.
--
-- Puts cpg_write back exactly as the schema baseline has it, and drops the three policies the draft
-- split it into. ⚠️ It reopens the hole: a circuit's creator can again add any person to their own
-- circuit and read them. Roll back only for a fault in the draft itself.

drop policy if exists cpg_delete on public.circuit_person_groups;
drop policy if exists cpg_insert on public.circuit_person_groups;
drop policy if exists cpg_update on public.circuit_person_groups;

CREATE POLICY "cpg_write" ON "public"."circuit_person_groups" TO "authenticated" USING (("public"."is_admin"() OR ("public"."circuit_can_edit_person"("person_id") AND "public"."circuit_is_member"("group_id")) OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_person_groups"."group_id") AND ("g"."created_by" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR ("public"."circuit_can_edit_person"("person_id") AND "public"."circuit_is_member"("group_id")) OR (EXISTS ( SELECT 1
   FROM "public"."circuit_groups" "g"
  WHERE (("g"."id" = "circuit_person_groups"."group_id") AND ("g"."created_by" = "auth"."uid"()))))));
