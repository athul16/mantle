// Generated from the Supabase schema. Regenerate after every migration:
//   pnpm supabase gen types typescript --project-id fexzsiizgcjuddtoeaui > src/lib/database.types.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      action_events: {
        Row: {
          at: string
          attempt_id: string
          id: number
          kind: string
          org_id: string
          payload: Json
        }
        Insert: {
          at?: string
          attempt_id: string
          id?: never
          kind: string
          org_id: string
          payload?: Json
        }
        Update: {
          at?: string
          attempt_id?: string
          id?: never
          kind?: string
          org_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "action_events_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      ai_shadow_scores: {
        Row: {
          attempt_id: string
          cache_creation_input_tokens: number | null
          cache_read_input_tokens: number | null
          created_at: string
          criteria: Json
          duration_ms: number | null
          error: string | null
          id: number
          input_tokens: number | null
          max_points: number | null
          model: string
          org_id: string
          output_tokens: number | null
          points: number | null
          prompt_version: string
          status: string
          step_id: string
          stop_reason: string | null
        }
        Insert: {
          attempt_id: string
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          criteria?: Json
          duration_ms?: number | null
          error?: string | null
          id?: never
          input_tokens?: number | null
          max_points?: number | null
          model: string
          org_id: string
          output_tokens?: number | null
          points?: number | null
          prompt_version: string
          status: string
          step_id: string
          stop_reason?: string | null
        }
        Update: {
          attempt_id?: string
          cache_creation_input_tokens?: number | null
          cache_read_input_tokens?: number | null
          created_at?: string
          criteria?: Json
          duration_ms?: number | null
          error?: string | null
          id?: never
          input_tokens?: number | null
          max_points?: number | null
          model?: string
          org_id?: string
          output_tokens?: number | null
          points?: number | null
          prompt_version?: string
          status?: string
          step_id?: string
          stop_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_shadow_scores_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          id: string
          locked_at: string | null
          org_id: string
          pass_score: number | null
          proctoring: Json
          scenario_id: string
          time_limit_minutes: number
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          locked_at?: string | null
          org_id: string
          pass_score?: number | null
          proctoring?: Json
          scenario_id: string
          time_limit_minutes: number
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          locked_at?: string | null
          org_id?: string
          pass_score?: number | null
          proctoring?: Json
          scenario_id?: string
          time_limit_minutes?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_secrets: {
        Row: {
          attempt_id: string
          org_id: string
          seed: string
          session_token_hash: string | null
        }
        Insert: {
          attempt_id: string
          org_id: string
          seed: string
          session_token_hash?: string | null
        }
        Update: {
          attempt_id?: string
          org_id?: string
          seed?: string
          session_token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempt_secrets_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      attempts: {
        Row: {
          auto_score: Json | null
          created_at: string
          deadline_at: string | null
          id: string
          integrity_label: string | null
          invite_id: string
          org_id: string
          scenario_id: string
          score: Json | null
          started_at: string | null
          status: string
          submit_reason: string | null
          submitted_at: string | null
        }
        Insert: {
          auto_score?: Json | null
          created_at?: string
          deadline_at?: string | null
          id?: string
          integrity_label?: string | null
          invite_id: string
          org_id: string
          scenario_id: string
          score?: Json | null
          started_at?: string | null
          status?: string
          submit_reason?: string | null
          submitted_at?: string | null
        }
        Update: {
          auto_score?: Json | null
          created_at?: string
          deadline_at?: string | null
          id?: string
          integrity_label?: string | null
          invite_id?: string
          org_id?: string
          scenario_id?: string
          score?: Json | null
          started_at?: string | null
          status?: string
          submit_reason?: string | null
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_invite_id_org_id_fkey"
            columns: ["invite_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "attempts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          id: number
          org_id: string
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          id?: never
          org_id: string
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          id?: never
          org_id?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      flags: {
        Row: {
          attempt_id: string
          created_at: string
          evidence: Json
          id: string
          org_id: string
          reason: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule: string | null
          status: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          evidence?: Json
          id?: string
          org_id: string
          reason: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule?: string | null
          status?: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          org_id?: string
          reason?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "flags_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      integrity_events: {
        Row: {
          at: string
          attempt_id: string
          id: number
          kind: string
          org_id: string
          payload: Json
        }
        Insert: {
          at?: string
          attempt_id: string
          id?: never
          kind: string
          org_id: string
          payload?: Json
        }
        Update: {
          at?: string
          attempt_id?: string
          id?: never
          kind?: string
          org_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "integrity_events_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      invite_accommodations: {
        Row: {
          extra_time_percent: number
          invite_id: string
          org_id: string
          set_at: string
          set_by: string | null
          waive_camera: boolean
          waive_fullscreen: boolean
          waive_microphone: boolean
          waive_screen: boolean
        }
        Insert: {
          extra_time_percent?: number
          invite_id: string
          org_id: string
          set_at?: string
          set_by?: string | null
          waive_camera?: boolean
          waive_fullscreen?: boolean
          waive_microphone?: boolean
          waive_screen?: boolean
        }
        Update: {
          extra_time_percent?: number
          invite_id?: string
          org_id?: string
          set_at?: string
          set_by?: string | null
          waive_camera?: boolean
          waive_fullscreen?: boolean
          waive_microphone?: boolean
          waive_screen?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "invite_accommodations_invite_id_org_id_fkey"
            columns: ["invite_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invite_accommodations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_secrets: {
        Row: {
          code_attempts: number
          code_expires_at: string | null
          code_hash: string | null
          invite_id: string
          org_id: string
          token_hash: string
        }
        Insert: {
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          invite_id: string
          org_id: string
          token_hash: string
        }
        Update: {
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          invite_id?: string
          org_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_secrets_invite_id_org_id_fkey"
            columns: ["invite_id", "org_id"]
            isOneToOne: false
            referencedRelation: "invites"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      invites: {
        Row: {
          candidate_name: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          job_id: string
          last_sent_at: string
          org_id: string
          sent_count: number
          status: string
        }
        Insert: {
          candidate_name?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          job_id: string
          last_sent_at?: string
          org_id: string
          sent_count?: number
          status?: string
        }
        Update: {
          candidate_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          job_id?: string
          last_sent_at?: string
          org_id?: string
          sent_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_job_id_org_id_fkey"
            columns: ["job_id", "org_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          assessment_id: string
          created_at: string
          deadline: string | null
          id: string
          org_id: string
          title: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          deadline?: string | null
          id?: string
          org_id: string
          title: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          deadline?: string | null
          id?: string
          org_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assessment_id_org_id_fkey"
            columns: ["assessment_id", "org_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          at: string
          attempt_id: string
          id: number
          org_id: string
          reason: string | null
          source: string
          storage_path: string
        }
        Insert: {
          at?: string
          attempt_id: string
          id?: never
          org_id: string
          reason?: string | null
          source: string
          storage_path: string
        }
        Update: {
          at?: string
          attempt_id?: string
          id?: never
          org_id?: string
          reason?: string | null
          source?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          attempt_id: string
          author_id: string
          body: string
          created_at: string
          id: string
          org_id: string
          vote: string | null
        }
        Insert: {
          attempt_id: string
          author_id: string
          body?: string
          created_at?: string
          id?: string
          org_id: string
          vote?: string | null
        }
        Update: {
          attempt_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          org_id?: string
          vote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_path: string | null
          name: string
          settings: Json
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name: string
          settings?: Json
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_path?: string | null
          name?: string
          settings?: Json
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          first_sign_in_at: string | null
          id: string
          invited_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          first_sign_in_at?: string | null
          id: string
          invited_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          first_sign_in_at?: string | null
          id?: string
          invited_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scenarios: {
        Row: {
          created_at: string
          definition: Json
          id: string
          org_id: string | null
          published_at: string | null
          role_family: string
          slug: string
          title: string
          version: number
        }
        Insert: {
          created_at?: string
          definition: Json
          id?: string
          org_id?: string | null
          published_at?: string | null
          role_family: string
          slug: string
          title: string
          version?: number
        }
        Update: {
          created_at?: string
          definition?: Json
          id?: string
          org_id?: string | null
          published_at?: string | null
          role_family?: string
          slug?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scenarios_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      step_responses: {
        Row: {
          answer: Json
          attempt_id: string
          auto_score: Json | null
          org_id: string
          score: Json | null
          step_id: string
          updated_at: string
        }
        Insert: {
          answer: Json
          attempt_id: string
          auto_score?: Json | null
          org_id: string
          score?: Json | null
          step_id: string
          updated_at?: string
        }
        Update: {
          answer?: Json
          attempt_id?: string
          auto_score?: Json | null
          org_id?: string
          score?: Json | null
          step_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_responses_attempt_id_org_id_fkey"
            columns: ["attempt_id", "org_id"]
            isOneToOne: false
            referencedRelation: "attempts"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: { Args: { org_name: string }; Returns: string }
      delete_candidate_data: { Args: { p_invite_id: string }; Returns: string[] }
      list_candidates_past_retention: {
        Args: { p_limit?: number; p_now?: string }
        Returns: { invite_id: string; org_id: string; retained_until: string }[]
      }
      list_media_past_retention: {
        Args: { p_limit?: number; p_now?: string }
        Returns: { attempt_id: string; org_id: string; retained_until: string }[]
      }
      purge_candidate_for_retention: {
        Args: { p_invite_id: string; p_now?: string }
        Returns: string[]
      }
      purge_media_for_retention: {
        Args: { p_attempt_id: string; p_now?: string }
        Returns: string[]
      }
      review_rubric_step: {
        Args: { p_attempt_id: string; p_scores: Json; p_step_id: string }
        Returns: Json
      }
      set_contact_email: {
        Args: { p_email: string; p_org_id: string }
        Returns: string
      }
      set_invite_accommodations: {
        Args: {
          p_extra_time_percent: number
          p_invite_id: string
          p_waive_camera: boolean
          p_waive_fullscreen?: boolean
          p_waive_microphone?: boolean
          p_waive_screen: boolean
        }
        Returns: undefined
      }
      set_retention: {
        Args: { p_media_days: number; p_org_id: string; p_results_days: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> = DefaultSchema["Tables"][T]["Update"]
