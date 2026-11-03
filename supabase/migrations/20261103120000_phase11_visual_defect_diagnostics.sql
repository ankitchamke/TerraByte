-- ==============================================================================
-- TerraByte Phase 11.B — Multimodal Visual Defect Diagnostics & Staging Contract
-- Migration: 20261103120000_phase11_visual_defect_diagnostics.sql
-- Description:
-- 1. claim_repair_visual_diagnostic: Atomic claim, cooldown, consent & state machine.
-- 2. save_repair_visual_diagnostic: Service-role only, catalogue model-compatibility check.
-- 3. finalize_repair_visual_diagnostic_failure: Service-role only, atomic failure finalizer.
-- 4. revoke_repair_visual_consent: Owning farmer or admin consent withdrawal.
-- 5. grant_repair_visual_consent: Strictly owning farmer consent grant.
-- 6. admin_repair_corrupted_diagnostic: Admin-only failure recovery.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. RPC: claim_repair_visual_diagnostic
-- ------------------------------------------------------------------------------
create or replace function public.claim_repair_visual_diagnostic(
  p_repair_request_id uuid,
  p_force_rescan boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_profile_id uuid := public.current_profile_id();
  v_caller_role public.user_role := public.current_user_role();
  v_record record;
  v_vd jsonb;
  v_status text;
  v_attempts integer := 0;
  v_rescan_count integer := 0;
  v_claimed_at timestamptz;
  v_last_attempt_at timestamptz;
  v_claim_token uuid;
  v_photos_count integer;
  v_consent jsonb;
  v_opt_in_granted boolean := false;
  v_is_corrupted boolean := false;
  
  -- Strict Constants
  c_stale_seconds constant interval := interval '60 seconds';
  c_cooldown_seconds constant interval := interval '30 seconds';
  c_max_attempts constant integer := 3;
  c_max_rescans constant integer := 5;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  
  v_prior_history jsonb;
  v_archived_entry jsonb;
  v_raw_val text;
begin
  -- 1. Verify authenticated profile identity
  if v_caller_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- 2. Lock target repair request row
  select 
    id, farmer_id, technician_id, photos, assessment
  into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  -- 3. Authorization check using verified repository columns
  if v_caller_role = 'farmer' then
    if v_record.farmer_id != v_caller_profile_id then
      return jsonb_build_object('success', false, 'error', 'FORBIDDEN_REQUEST_ACCESS');
    end if;
    if p_force_rescan then
      return jsonb_build_object('success', false, 'error', 'FORBIDDEN_FARMER_CANNOT_FORCE_RESCAN');
    end if;
  elsif v_caller_role = 'technician' then
    if v_record.technician_id is null then
      return jsonb_build_object('success', false, 'error', 'CANNOT_ACCESS_UNASSIGNED_TICKET');
    end if;
    if v_record.technician_id != v_caller_profile_id then
      return jsonb_build_object('success', false, 'error', 'FORBIDDEN_TECHNICIAN_NOT_ASSIGNED');
    end if;
  elsif v_caller_role != 'admin' then
    return jsonb_build_object('success', false, 'error', 'UNAUTHORIZED_ROLE');
  end if;

  -- 4. Mandatory Farmer Consent Gate (Non-bypassable by staff or admin)
  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);
  v_consent := coalesce(v_vd->'consent', '{}'::jsonb);
  
  v_opt_in_granted := coalesce(
    jsonb_typeof(v_consent->'optInGranted') = 'boolean' 
    and (v_consent->'optInGranted') = 'true'::jsonb, 
    false
  );

  if not v_opt_in_granted then
    return jsonb_build_object(
      'success', false, 
      'error', 'CONSENT_NOT_GRANTED', 
      'details', 'Farmer has not opted in to AI Visual Diagnostics for this repair request.'
    );
  end if;

  -- 5. Photo Validation Gate (Requires between 1 and 4 photos)
  v_photos_count := coalesce(array_length(v_record.photos, 1), 0);
  if v_photos_count = 0 then
    return jsonb_build_object('success', false, 'error', 'NO_PHOTOS_AVAILABLE');
  end if;

  -- 6. Safe Fail-Closed Metadata Parsing
  v_status := coalesce(v_vd->>'status', 'NOT_REQUESTED');

  -- 6.1 Strictly bounded attempts parsing (0-3)
  v_raw_val := v_vd->>'attempts';
  if v_raw_val is null then
    v_attempts := 0;
  elsif v_raw_val ~ '^[0-3]$' then
    v_attempts := v_raw_val::integer;
  else
    v_is_corrupted := true;
    v_attempts := c_max_attempts;
  end if;

  -- 6.2 Strictly bounded rescan_count parsing (0-5)
  v_raw_val := v_vd->>'rescan_count';
  if v_raw_val is null then
    v_rescan_count := 0;
  elsif v_raw_val ~ '^[0-5]$' then
    v_rescan_count := v_raw_val::integer;
  else
    v_is_corrupted := true;
    v_rescan_count := c_max_rescans;
  end if;

  -- 6.3 Fail-closed claimed_at parsing (cannot be stolen as stale if corrupt)
  v_raw_val := v_vd->>'claimed_at';
  if v_raw_val is not null then
    if v_raw_val ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' then
      begin
        v_claimed_at := v_raw_val::timestamptz;
      exception when others then
        v_is_corrupted := true;
        v_claimed_at := c_now;
      end;
    else
      v_is_corrupted := true;
      v_claimed_at := c_now;
    end if;
  else
    v_claimed_at := null;
  end if;

  -- 6.4 Fail-closed lastAttemptAt parsing (cannot bypass cooldown if corrupt)
  v_raw_val := v_vd->>'lastAttemptAt';
  if v_raw_val is not null then
    if v_raw_val ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' then
      begin
        v_last_attempt_at := v_raw_val::timestamptz;
      exception when others then
        v_is_corrupted := true;
        v_last_attempt_at := c_now;
      end;
    else
      v_is_corrupted := true;
      v_last_attempt_at := c_now;
    end if;
  else
    v_last_attempt_at := null;
  end if;

  -- 6.5 Fail-closed rejection of corrupted metadata
  if v_is_corrupted then
    return jsonb_build_object(
      'success', false,
      'error', 'CORRUPTED_METADATA_ADMIN_REPAIR_REQUIRED',
      'details', 'Diagnostic metadata is corrupted. Administrator must repair.'
    );
  end if;

  -- 7. Staff Force Re-scan Branch (p_force_rescan = true)
  if p_force_rescan then
    -- Must be strictly terminal state
    if v_status not in ('FAILED', 'ANALYZED', 'SKIPPED') then
      return jsonb_build_object(
        'success', false,
        'error', 'INVALID_FORCE_RESCAN_SOURCE_STATE',
        'current_status', v_status,
        'details', 'Force rescan is only permitted from FAILED, ANALYZED, or SKIPPED states.'
      );
    end if;

    -- Enforce 30-second cooldown on staff rescan
    if v_last_attempt_at is not null and (c_now - v_last_attempt_at) < c_cooldown_seconds then
      return jsonb_build_object(
        'success', false,
        'error', 'COOLDOWN_ACTIVE',
        'retry_after_seconds', extract(epoch from (c_cooldown_seconds - (c_now - v_last_attempt_at)))::integer
      );
    end if;

    -- Enforce maximum 5 rescans
    if v_rescan_count >= c_max_rescans then
      return jsonb_build_object('success', false, 'error', 'MAX_RESCANS_EXCEEDED');
    end if;

    -- Archive previous state safely into history[]
    if jsonb_typeof(v_vd->'history') = 'array' then
      v_prior_history := v_vd->'history';
    else
      v_prior_history := '[]'::jsonb;
    end if;

    v_archived_entry := jsonb_build_object(
      'archivedAt', v_utc_now,
      'archivedByProfileId', v_caller_profile_id,
      'previousStatus', v_status,
      'attempts', v_attempts,
      'lastErrorCode', v_vd->>'lastErrorCode',
      'lastErrorMessage', v_vd->>'lastErrorMessage',
      'lastAttemptAt', v_vd->>'lastAttemptAt',
      'visualAnomalies', coalesce(v_vd->'visualAnomalies', '[]'::jsonb),
      'stagedParts', coalesce(v_vd->'stagedParts', '[]'::jsonb)
    );
    v_prior_history := v_prior_history || jsonb_build_array(v_archived_entry);

    -- Increment rescan counter, reset attempts to 1 for human cycle, generate claim token
    v_attempts := 1;
    v_rescan_count := v_rescan_count + 1;
    v_claim_token := gen_random_uuid();

    update public.repair_requests
    set assessment = jsonb_set(
      coalesce(assessment, '{}'::jsonb),
      '{visualDiagnostics}',
      jsonb_build_object(
        'status', 'PROCESSING',
        'claim_token', v_claim_token,
        'claimed_at', v_utc_now,
        'lastAttemptAt', v_utc_now,
        'claimedByProfileId', v_caller_profile_id,
        'attempts', v_attempts,
        'rescan_count', v_rescan_count,
        'consent', v_consent,
        'history', v_prior_history
      )
    )
    where id = p_repair_request_id;

    return jsonb_build_object(
      'success', true,
      'claim_token', v_claim_token,
      'status', 'PROCESSING',
      'attempt', v_attempts,
      'rescan_count', v_rescan_count
    );
  end if;

  -- 8. Standard Claims Branch (p_force_rescan = false)
  if v_status = 'NOT_REQUESTED' then
    -- Enforce 30-second cooldown if a prior attempt occurred
    if v_last_attempt_at is not null and (c_now - v_last_attempt_at) < c_cooldown_seconds then
      return jsonb_build_object(
        'success', false, 
        'error', 'COOLDOWN_ACTIVE', 
        'retry_after_seconds', extract(epoch from (c_cooldown_seconds - (c_now - v_last_attempt_at)))::integer
      );
    end if;

    -- If prior attempts already exhausted ceiling, atomically transition to FAILED
    if v_attempts >= c_max_attempts then
      update public.repair_requests
      set assessment = jsonb_set(
        coalesce(assessment, '{}'::jsonb),
        '{visualDiagnostics}',
        v_vd || jsonb_build_object(
          'status', 'FAILED',
          'claim_token', null,
          'attempts', v_attempts,
          'rescan_count', v_rescan_count,
          'lastAttemptAt', coalesce(v_vd->>'lastAttemptAt', v_utc_now),
          'lastErrorCode', 'MAX_ATTEMPTS_EXCEEDED',
          'lastErrorMessage', 'Maximum automated diagnostic attempts exhausted. Requires staff force rescan.',
          'consent', v_consent,
          'history', coalesce(v_vd->'history', '[]'::jsonb)
        )
      )
      where id = p_repair_request_id;

      return jsonb_build_object(
        'success', false, 
        'error', 'MAX_ATTEMPTS_EXCEEDED',
        'status', 'FAILED',
        'details', 'Ticket transitioned to FAILED. An authorized assigned technician or administrator must force rescan.'
      );
    end if;

    -- Valid standard claim
    v_attempts := v_attempts + 1;
    v_claim_token := gen_random_uuid();

    update public.repair_requests
    set assessment = jsonb_set(
      coalesce(assessment, '{}'::jsonb),
      '{visualDiagnostics}',
      jsonb_build_object(
        'status', 'PROCESSING',
        'claim_token', v_claim_token,
        'claimed_at', v_utc_now,
        'lastAttemptAt', v_utc_now,
        'claimedByProfileId', v_caller_profile_id,
        'attempts', v_attempts,
        'rescan_count', v_rescan_count,
        'consent', v_consent,
        'history', coalesce(v_vd->'history', '[]'::jsonb)
      )
    )
    where id = p_repair_request_id;

    return jsonb_build_object(
      'success', true,
      'claim_token', v_claim_token,
      'status', 'PROCESSING',
      'attempt', v_attempts,
      'rescan_count', v_rescan_count
    );

  elsif v_status = 'PROCESSING' then
    -- Check for stale claim timeout
    if v_claimed_at is not null and (c_now - v_claimed_at) > c_stale_seconds then
      if v_attempts >= c_max_attempts then
        update public.repair_requests
        set assessment = jsonb_set(
          assessment,
          '{visualDiagnostics}',
          v_vd || jsonb_build_object(
            'status', 'FAILED',
            'claim_token', null,
            'lastErrorCode', 'STALE_CLAIM_TIMEOUT_MAX_ATTEMPTS',
            'lastErrorMessage', 'Prior analysis worker timed out and maximum retry attempts reached.',
            'lastAttemptAt', v_utc_now
          )
        )
        where id = p_repair_request_id;

        return jsonb_build_object('success', false, 'error', 'MAX_ATTEMPTS_EXCEEDED');
      end if;

      if v_last_attempt_at is not null and (c_now - v_last_attempt_at) < c_cooldown_seconds then
        return jsonb_build_object(
          'success', false, 
          'error', 'COOLDOWN_ACTIVE', 
          'retry_after_seconds', extract(epoch from (c_cooldown_seconds - (c_now - v_last_attempt_at)))::integer
        );
      end if;

      v_attempts := v_attempts + 1;
      v_claim_token := gen_random_uuid();

      update public.repair_requests
      set assessment = jsonb_set(
        assessment,
        '{visualDiagnostics}',
        v_vd || jsonb_build_object(
          'claim_token', v_claim_token,
          'claimed_at', v_utc_now,
          'lastAttemptAt', v_utc_now,
          'claimedByProfileId', v_caller_profile_id,
          'attempts', v_attempts
        )
      )
      where id = p_repair_request_id;

      return jsonb_build_object(
        'success', true,
        'claim_token', v_claim_token,
        'status', 'PROCESSING',
        'attempt', v_attempts
      );
    else
      return jsonb_build_object('success', false, 'error', 'ALREADY_PROCESSING');
    end if;

  elsif v_status = 'RETRYABLE_ERROR' then
    if v_attempts >= c_max_attempts then
      update public.repair_requests
      set assessment = jsonb_set(
        assessment,
        '{visualDiagnostics}',
        v_vd || jsonb_build_object(
          'status', 'FAILED',
          'claim_token', null,
          'lastErrorCode', 'MAX_RETRIES_EXCEEDED',
          'lastErrorMessage', 'All retry attempts exhausted. Requires staff force rescan.',
          'lastAttemptAt', v_utc_now
        )
      )
      where id = p_repair_request_id;

      return jsonb_build_object(
        'success', false, 
        'error', 'MAX_ATTEMPTS_EXCEEDED', 
        'status', 'FAILED',
        'details', 'Ticket reached 3 attempts and has transitioned to FAILED. Requires staff force rescan.'
      );
    end if;

    if v_last_attempt_at is not null and (c_now - v_last_attempt_at) < c_cooldown_seconds then
      return jsonb_build_object(
        'success', false, 
        'error', 'COOLDOWN_ACTIVE', 
        'retry_after_seconds', extract(epoch from (c_cooldown_seconds - (c_now - v_last_attempt_at)))::integer
      );
    end if;

    v_attempts := v_attempts + 1;
    v_claim_token := gen_random_uuid();

    update public.repair_requests
    set assessment = jsonb_set(
      assessment,
      '{visualDiagnostics}',
      v_vd || jsonb_build_object(
        'status', 'PROCESSING',
        'claim_token', v_claim_token,
        'claimed_at', v_utc_now,
        'lastAttemptAt', v_utc_now,
        'claimedByProfileId', v_caller_profile_id,
        'attempts', v_attempts
      )
    )
    where id = p_repair_request_id;

    return jsonb_build_object(
      'success', true,
      'claim_token', v_claim_token,
      'status', 'PROCESSING',
      'attempt', v_attempts,
      'rescan_count', v_rescan_count
    );

  elsif v_status in ('ANALYZED', 'FAILED', 'SKIPPED') then
    return jsonb_build_object(
      'success', false, 
      'error', 'TERMINAL_STATE', 
      'status', v_status,
      'details', 'Terminal state reached. Requires authorized staff force rescan.'
    );

  else
    return jsonb_build_object('success', false, 'error', 'UNKNOWN_DIAGNOSTIC_STATE', 'status', v_status);
  end if;
end;
$$;

revoke all on function public.claim_repair_visual_diagnostic(uuid, boolean) from public, anon, service_role;
grant execute on function public.claim_repair_visual_diagnostic(uuid, boolean) to authenticated;


-- ------------------------------------------------------------------------------
-- 2. RPC: save_repair_visual_diagnostic
-- ------------------------------------------------------------------------------
create or replace function public.save_repair_visual_diagnostic(
  p_repair_request_id uuid,
  p_claim_token uuid,
  p_executed_by_profile_id uuid,
  p_diagnostic_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jwt_role text;
  v_record record;
  v_eq_make text;
  v_eq_model text;
  v_machine_model text;
  v_vd jsonb;
  v_active_token uuid;
  v_claimed_by uuid;
  v_status text;
  v_consent jsonb;
  v_opt_in_granted boolean := false;
  v_part jsonb;
  v_raw_qty text;
  v_qty integer;
  v_db_part record;
  v_staged_entry jsonb;
  v_validated_staged_parts jsonb := '[]'::jsonb;
  v_attempts integer;
  v_rescan_count integer;
  v_raw_val text;
  c_max_attempts constant integer := 3;
  c_max_rescans constant integer := 5;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  -- 1. Defense-in-depth verification of service_role call (never relies on current_user = 'postgres')
  v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), auth.role(), '');
  if v_jwt_role is distinct from 'service_role' and session_user is distinct from 'postgres' then
    return jsonb_build_object('success', false, 'error', 'ACCESS_DENIED_SERVICE_ROLE_ONLY');
  end if;

  -- 2. Lock target repair request row (including equipment_id)
  select 
    id, farmer_id, technician_id, equipment_id, assessment
  into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);

  -- 3. Verify executor identity matches active claim metadata
  begin
    v_claimed_by := (v_vd->>'claimedByProfileId')::uuid;
  exception when others then
    v_claimed_by := null;
  end;

  if v_claimed_by is null or v_claimed_by is distinct from p_executed_by_profile_id then
    return jsonb_build_object('success', false, 'error', 'EXECUTOR_MISMATCH_WITH_CLAIM');
  end if;

  -- 4. Strict Fail-Closed Farmer Consent Verification (Literal JSON boolean true required)
  v_consent := coalesce(v_vd->'consent', '{}'::jsonb);
  v_opt_in_granted := coalesce(
    jsonb_typeof(v_consent->'optInGranted') = 'boolean' 
    and (v_consent->'optInGranted') = 'true'::jsonb, 
    false
  );

  if not v_opt_in_granted then
    update public.repair_requests
    set assessment = jsonb_set(
      coalesce(assessment, '{}'::jsonb),
      '{visualDiagnostics}',
      jsonb_build_object(
        'status', 'SKIPPED',
        'reason', 'CONSENT_WITHDRAWN_DURING_EXECUTION',
        'claim_token', null,
        'consent', v_consent,
        'history', coalesce(v_vd->'history', '[]'::jsonb),
        'updatedAt', v_utc_now
      )
    )
    where id = p_repair_request_id;

    return jsonb_build_object('success', false, 'error', 'CONSENT_WITHDRAWN_DURING_EXECUTION');
  end if;

  -- 5. Validate Atomic Claim Token & PROCESSING State (using IS DISTINCT FROM)
  v_status := v_vd->>'status';
  if v_status is distinct from 'PROCESSING' then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATE_FOR_SAVE', 'current_status', v_status);
  end if;

  begin
    v_active_token := (v_vd->>'claim_token')::uuid;
  exception when others then
    v_active_token := null;
  end;

  if v_active_token is distinct from p_claim_token or p_claim_token is null then
    return jsonb_build_object('success', false, 'error', 'STALE_OR_INVALID_CLAIM_TOKEN');
  end if;

  -- 6. Validate Payload Structure & High-Level Types
  if jsonb_typeof(p_diagnostic_payload) != 'object' then
    return jsonb_build_object('success', false, 'error', 'MALFORMED_PAYLOAD_NOT_OBJECT');
  end if;

  if p_diagnostic_payload->>'status' != 'ANALYZED' then
    return jsonb_build_object('success', false, 'error', 'INVALID_TARGET_STATUS_MUST_BE_ANALYZED');
  end if;

  if jsonb_typeof(p_diagnostic_payload->'visualAnomalies') != 'array' then
    return jsonb_build_object('success', false, 'error', 'INVALID_FIELD_TYPE_VISUAL_ANOMALIES');
  end if;

  if jsonb_typeof(p_diagnostic_payload->'stagedParts') != 'array' then
    return jsonb_build_object('success', false, 'error', 'INVALID_FIELD_TYPE_STAGED_PARTS');
  end if;

  if jsonb_typeof(p_diagnostic_payload->'safetyGuidance') != 'array' then
    return jsonb_build_object('success', false, 'error', 'INVALID_FIELD_TYPE_SAFETY_GUIDANCE');
  end if;

  if p_diagnostic_payload->>'overallVisualSummary' is null or length(trim(p_diagnostic_payload->>'overallVisualSummary')) = 0 then
    return jsonb_build_object('success', false, 'error', 'MISSING_REQUIRED_FIELD_SUMMARY');
  end if;

  if p_diagnostic_payload->>'visualConfidence' not in ('HIGH', 'MEDIUM', 'LOW') then
    return jsonb_build_object('success', false, 'error', 'INVALID_CONFIDENCE_VALUE');
  end if;

  -- 7. Fetch Machinery Make and Model for Compatibility Verification
  select make, model into v_eq_make, v_eq_model
  from public.equipment
  where id = v_record.equipment_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'EQUIPMENT_RECORD_NOT_FOUND');
  end if;

  v_machine_model := trim(concat(v_eq_make, ' ', v_eq_model));

  -- 8. Validate, Match, and Filter Staged Parts Against Actual Live Catalogue Records
  for v_part in select * from jsonb_array_elements(p_diagnostic_payload->'stagedParts') loop
    if jsonb_typeof(v_part) != 'object' or v_part->>'partNumber' is null or length(trim(v_part->>'partNumber')) = 0 then
      return jsonb_build_object('success', false, 'error', 'MALFORMED_STAGED_PART_OBJECT');
    end if;

    -- Pre-cast validation of quantity
    v_raw_qty := v_part->>'estimatedQuantity';
    if v_raw_qty is not null then
      if v_raw_qty !~ '^[0-9]{1,2}$' then
        return jsonb_build_object('success', false, 'error', 'INVALID_QUANTITY_FORMAT', 'part_number', v_part->>'partNumber');
      end if;
      v_qty := v_raw_qty::integer;
      if v_qty < 1 or v_qty > 10 then
        return jsonb_build_object('success', false, 'error', 'QUANTITY_OUT_OF_BOUNDS', 'part_number', v_part->>'partNumber');
      end if;
    else
      v_qty := 1;
    end if;

    if v_part->>'confidence' is not null and v_part->>'confidence' not in ('HIGH', 'MEDIUM', 'LOW') then
      return jsonb_build_object('success', false, 'error', 'INVALID_PART_CONFIDENCE_VALUE', 'part_number', v_part->>'partNumber');
    end if;

    -- Lookup Live Catalogue Record
    select 
      id, part_number, name, category, stock_quantity, unit_price, compatible_models
    into v_db_part
    from public.service_centre_parts
    where part_number = v_part->>'partNumber';

    if not found then
      return jsonb_build_object('success', false, 'error', 'STAGED_PART_NOT_IN_CATALOGUE', 'part_number', v_part->>'partNumber');
    end if;

    -- Strict Machine-Model Compatibility Verification
    if (
      v_db_part.compatible_models is not null
      and cardinality(v_db_part.compatible_models) > 0
      and (
        v_machine_model = any(v_db_part.compatible_models)
        or trim(v_eq_model) = any(v_db_part.compatible_models)
      )
    ) then
      v_staged_entry := jsonb_build_object(
        'partId', v_db_part.id,
        'partNumber', v_db_part.part_number,
        'name', v_db_part.name,
        'category', v_db_part.category,
        'currentStock', v_db_part.stock_quantity,
        'unitPrice', v_db_part.unit_price,
        'estimatedQuantity', v_qty,
        'confidence', coalesce(v_part->>'confidence', 'MEDIUM'),
        'reasoning', coalesce(v_part->>'reasoning', '')
      );
      v_validated_staged_parts := v_validated_staged_parts || jsonb_build_array(v_staged_entry);
    else
      -- Compatibility cannot be established: safely omit candidate part from stagedParts
      null;
    end if;
  end loop;

  -- 9. Strictly bounded parsing of attempts and rescan_count
  v_raw_val := v_vd->>'attempts';
  if v_raw_val is not null and v_raw_val ~ '^[0-3]$' then
    v_attempts := v_raw_val::integer;
  else
    v_attempts := c_max_attempts;
  end if;

  v_raw_val := v_vd->>'rescan_count';
  if v_raw_val is not null and v_raw_val ~ '^[0-5]$' then
    v_rescan_count := v_raw_val::integer;
  else
    v_rescan_count := c_max_rescans;
  end if;

  -- 10. Persist Validated Result (Preserving all metadata, UTC timestamps, and legacy fields)
  update public.repair_requests
  set assessment = jsonb_set(
    coalesce(assessment, '{}'::jsonb),
    '{visualDiagnostics}',
    jsonb_build_object(
      'status', 'ANALYZED',
      'analyzedAt', v_utc_now,
      'claimed_at', v_vd->>'claimed_at',
      'claimedByProfileId', v_claimed_by,
      'executedByProfileId', p_executed_by_profile_id,
      'lastAttemptAt', v_utc_now,
      'claim_token', null,
      'attempts', v_attempts,
      'rescan_count', v_rescan_count,
      'visualConfidence', p_diagnostic_payload->>'visualConfidence',
      'overallVisualSummary', p_diagnostic_payload->>'overallVisualSummary',
      'visualAnomalies', p_diagnostic_payload->'visualAnomalies',
      'stagedParts', v_validated_staged_parts,
      'safetyGuidance', p_diagnostic_payload->'safetyGuidance',
      'consent', v_consent,
      'history', coalesce(v_vd->'history', '[]'::jsonb)
    )
  )
  where id = p_repair_request_id;

  return jsonb_build_object('success', true, 'status', 'ANALYZED');
end;
$$;

revoke all on function public.save_repair_visual_diagnostic(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_repair_visual_diagnostic(uuid, uuid, uuid, jsonb) to service_role;


-- ------------------------------------------------------------------------------
-- 3. RPC: finalize_repair_visual_diagnostic_failure
-- ------------------------------------------------------------------------------
create or replace function public.finalize_repair_visual_diagnostic_failure(
  p_repair_request_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_error_message text,
  p_is_terminal boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_jwt_role text;
  v_record record;
  v_vd jsonb;
  v_active_token uuid;
  v_attempts integer;
  v_rescan_count integer;
  v_raw_val text;
  v_target_status text;
  v_sanitized_code text;
  v_sanitized_message text;
  c_max_attempts constant integer := 3;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  -- 1. Defense-in-depth verification of service_role call
  v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), auth.role(), '');
  if v_jwt_role is distinct from 'service_role' and session_user is distinct from 'postgres' then
    return jsonb_build_object('success', false, 'error', 'ACCESS_DENIED_SERVICE_ROLE_ONLY');
  end if;

  -- 2. Reject NULL parameters explicitly
  if p_repair_request_id is null or p_claim_token is null or p_is_terminal is null then
    return jsonb_build_object('success', false, 'error', 'INVALID_NULL_ARGUMENTS');
  end if;

  -- 3. Allowlist error codes & sanitized server messages (never stores raw provider details)
  if p_error_code in ('TIMEOUT', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'SCHEMA_VALIDATION_ERROR', 'CONFIG_ERROR', 'NETWORK_ERROR') then
    v_sanitized_code := p_error_code;
  else
    v_sanitized_code := 'UNEXPECTED_ERROR';
  end if;

  v_sanitized_message := substring(trim(regexp_replace(coalesce(p_error_message, 'Diagnostic service failure.'), '[\r\n\t]+', ' ', 'g')) from 1 for 255);

  -- 4. Lock target repair request row
  select id, assessment into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);

  -- 5. Status validation: uses IS DISTINCT FROM so NULL is safely rejected
  if (v_vd->>'status') is distinct from 'PROCESSING' then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATE_FOR_FAILURE_FINALIZATION', 'current_status', v_vd->>'status');
  end if;

  -- 6. Verify active claim token
  begin
    v_active_token := (v_vd->>'claim_token')::uuid;
  exception when others then
    v_active_token := null;
  end;

  if v_active_token is distinct from p_claim_token or p_claim_token is null then
    return jsonb_build_object('success', false, 'error', 'STALE_OR_INVALID_CLAIM_TOKEN');
  end if;

  -- 7. Strictly bounded parsing of attempts and rescan_count
  v_raw_val := v_vd->>'attempts';
  if v_raw_val is not null and v_raw_val ~ '^[0-3]$' then
    v_attempts := v_raw_val::integer;
  else
    v_attempts := c_max_attempts;
  end if;

  v_raw_val := v_vd->>'rescan_count';
  if v_raw_val is not null and v_raw_val ~ '^[0-5]$' then
    v_rescan_count := v_raw_val::integer;
  else
    v_rescan_count := 5;
  end if;

  -- 8. Determine target status
  if p_is_terminal or v_attempts >= c_max_attempts then
    v_target_status := 'FAILED';
  else
    v_target_status := 'RETRYABLE_ERROR';
  end if;

  -- 9. Atomically persist failure: clears claim token, sets actual UTC timestamp for cooldown
  update public.repair_requests
  set assessment = jsonb_set(
    coalesce(assessment, '{}'::jsonb),
    '{visualDiagnostics}',
    v_vd || jsonb_build_object(
      'status', v_target_status,
      'claim_token', null,
      'attempts', v_attempts,
      'rescan_count', v_rescan_count,
      'lastErrorCode', v_sanitized_code,
      'lastErrorMessage', v_sanitized_message,
      'lastAttemptAt', v_utc_now
    )
  )
  where id = p_repair_request_id;

  return jsonb_build_object(
    'success', true,
    'status', v_target_status,
    'attempts', v_attempts,
    'rescan_count', v_rescan_count
  );
end;
$$;

revoke all on function public.finalize_repair_visual_diagnostic_failure(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.finalize_repair_visual_diagnostic_failure(uuid, uuid, text, text, boolean) to service_role;


-- ------------------------------------------------------------------------------
-- 4. RPC: revoke_repair_visual_consent
-- ------------------------------------------------------------------------------
create or replace function public.revoke_repair_visual_consent(
  p_repair_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_profile_id uuid := public.current_profile_id();
  v_caller_role public.user_role := public.current_user_role();
  v_record record;
  v_vd jsonb;
  v_consent jsonb;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_caller_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  end if;

  select id, farmer_id, assessment into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  if v_caller_role != 'admin' and v_record.farmer_id != v_caller_profile_id then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN_REQUEST_ACCESS');
  end if;

  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);
  v_consent := coalesce(v_vd->'consent', '{}'::jsonb) || jsonb_build_object(
    'optInGranted', false,
    'withdrawnAt', v_utc_now
  );

  update public.repair_requests
  set assessment = jsonb_set(
    coalesce(assessment, '{}'::jsonb),
    '{visualDiagnostics}',
    v_vd || jsonb_build_object(
      'status', 'SKIPPED',
      'reason', 'CONSENT_WITHDRAWN_BY_FARMER',
      'claim_token', null,
      'consent', v_consent,
      'updatedAt', v_utc_now
    )
  )
  where id = p_repair_request_id;

  return jsonb_build_object('success', true, 'status', 'SKIPPED', 'consent_withdrawn', true);
end;
$$;

revoke all on function public.revoke_repair_visual_consent(uuid) from public, anon, service_role;
grant execute on function public.revoke_repair_visual_consent(uuid) to authenticated;


-- ------------------------------------------------------------------------------
-- 5. RPC: grant_repair_visual_consent
-- ------------------------------------------------------------------------------
create or replace function public.grant_repair_visual_consent(
  p_repair_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_profile_id uuid := public.current_profile_id();
  v_record record;
  v_vd jsonb;
  v_status text;
  v_consent jsonb;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_caller_profile_id is null then
    return jsonb_build_object('success', false, 'error', 'UNAUTHENTICATED');
  end if;

  select id, farmer_id, assessment into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  -- Strictly restricted to the owning farmer. Staff members cannot grant consent.
  if v_record.farmer_id != v_caller_profile_id then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN_ONLY_OWNING_FARMER_CAN_GRANT_CONSENT');
  end if;

  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);
  v_status := coalesce(v_vd->>'status', 'NOT_REQUESTED');

  -- Reject re-grant while an analysis is actively in flight
  if v_status = 'PROCESSING' then
    return jsonb_build_object(
      'success', false, 
      'error', 'CANNOT_GRANT_CONSENT_WHILE_PROCESSING',
      'details', 'Visual diagnostic is actively running. Wait for completion or timeout before modifying consent.'
    );
  end if;

  v_consent := jsonb_build_object(
    'optInGranted', true,
    'consentedAt', v_utc_now,
    'consentPolicyVersion', '2026-10-v1',
    'withdrawnAt', null
  );

  -- Safely reset SKIPPED tickets back to NOT_REQUESTED
  if v_status = 'SKIPPED' then
    v_status := 'NOT_REQUESTED';
  end if;

  update public.repair_requests
  set assessment = jsonb_set(
    coalesce(assessment, '{}'::jsonb),
    '{visualDiagnostics}',
    v_vd || jsonb_build_object(
      'status', v_status,
      'consent', v_consent,
      'claim_token', null,
      'updatedAt', v_utc_now
    )
  )
  where id = p_repair_request_id;

  return jsonb_build_object('success', true, 'status', v_status, 'consent_granted', true);
end;
$$;

revoke all on function public.grant_repair_visual_consent(uuid) from public, anon, service_role;
grant execute on function public.grant_repair_visual_consent(uuid) to authenticated;


-- ------------------------------------------------------------------------------
-- 6. RPC: admin_repair_corrupted_diagnostic
-- ------------------------------------------------------------------------------
create or replace function public.admin_repair_corrupted_diagnostic(
  p_repair_request_id uuid,
  p_target_status text default 'FAILED'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_profile_id uuid := public.current_profile_id();
  v_caller_role public.user_role := public.current_user_role();
  v_record record;
  v_vd jsonb;
  v_raw_attempts text;
  v_raw_rescan text;
  v_attempts integer;
  v_rescan_count integer;
  v_effective_status text;
  v_history jsonb;
  v_repair_audit jsonb;
  c_now constant timestamptz := clock_timestamp();
  v_utc_now text := to_char(c_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_caller_role is distinct from 'admin' then
    return jsonb_build_object('success', false, 'error', 'ADMIN_ONLY');
  end if;

  if p_target_status not in ('FAILED', 'NOT_REQUESTED') then
    return jsonb_build_object('success', false, 'error', 'INVALID_TARGET_REPAIR_STATUS');
  end if;

  select id, assessment into v_record
  from public.repair_requests
  where id = p_repair_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'REPAIR_REQUEST_NOT_FOUND');
  end if;

  v_vd := coalesce(v_record.assessment->'visualDiagnostics', '{}'::jsonb);

  -- Bounded Parsing for attempts (0-3). Never resets to zero unconditionally.
  v_raw_attempts := v_vd->>'attempts';
  if v_raw_attempts is not null and v_raw_attempts ~ '^[0-3]$' then
    v_attempts := v_raw_attempts::integer;
  else
    v_attempts := 3;
  end if;

  -- Bounded Parsing for rescan_count (0-5). Never resets to zero unconditionally.
  v_raw_rescan := v_vd->>'rescan_count';
  if v_raw_rescan is not null and v_raw_rescan ~ '^[0-5]$' then
    v_rescan_count := v_raw_rescan::integer;
  else
    v_rescan_count := 5;
  end if;

  -- Enforce Recovery Path: If attempts are exhausted (>=3), state MUST be FAILED
  if v_attempts >= 3 then
    v_effective_status := 'FAILED';
  else
    v_effective_status := p_target_status;
  end if;

  if jsonb_typeof(v_vd->'history') = 'array' then
    v_history := v_vd->'history';
  else
    v_history := '[]'::jsonb;
  end if;

  v_repair_audit := jsonb_build_object(
    'archivedAt', v_utc_now,
    'repairedByProfileId', v_caller_profile_id,
    'action', 'ADMIN_METADATA_REPAIR',
    'previousStatus', coalesce(v_vd->>'status', 'UNKNOWN'),
    'targetStatus', v_effective_status,
    'preservedAttempts', v_attempts,
    'preservedRescanCount', v_rescan_count
  );
  v_history := v_history || jsonb_build_array(v_repair_audit);

  update public.repair_requests
  set assessment = jsonb_set(
    coalesce(assessment, '{}'::jsonb),
    '{visualDiagnostics}',
    jsonb_build_object(
      'status', v_effective_status,
      'claim_token', null,
      'attempts', v_attempts,
      'rescan_count', v_rescan_count,
      'lastAttemptAt', v_utc_now,
      'lastErrorCode', 'ADMIN_CORRUPTED_METADATA_REPAIRED',
      'lastErrorMessage', 'Metadata sanitized by administrator.',
      'repairedAt', v_utc_now,
      'consent', coalesce(v_vd->'consent', '{}'::jsonb),
      'history', v_history
    )
  )
  where id = p_repair_request_id;

  return jsonb_build_object(
    'success', true, 
    'status', v_effective_status, 
    'attempts', v_attempts,
    'rescan_count', v_rescan_count
  );
end;
$$;

revoke all on function public.admin_repair_corrupted_diagnostic(uuid, text) from public, anon, service_role;
grant execute on function public.admin_repair_corrupted_diagnostic(uuid, text) to authenticated;
