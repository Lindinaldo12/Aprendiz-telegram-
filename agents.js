import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const localAgents = new Map();

export async function initAgents() {
  if (!supabase) return;
  const { error } = await supabase.rpc('create_sub_agents_table');
  if (error) console.error('[initAgents]', error.message);
}

export async function createAgent(name, systemPrompt) {
  const cleanName = name.trim().toLowerCase();
  const agent = {
    name: cleanName,
    system_prompt: systemPrompt,
    created_at: new Date().toISOString(),
  };

  if (supabase) {
    const { data, error } = await supabase
      .from('sub_agents')
      .insert(agent)
      .select()
      .single();
    if (error) {
      console.warn('[createAgent] Supabase falhou, usando memoria local:', error.message);
      localAgents.set(cleanName, agent);
      return agent;
    }
    return data;
  }

  localAgents.set(cleanName, agent);
  return agent;
}

export async function listAgents() {
  if (supabase) {
    const { data, error } = await supabase
      .from('sub_agents')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }
  return [...localAgents.values()];
}

export async function getAgent(name) {
  const cleanName = name.trim().toLowerCase();
  if (supabase) {
    const { data, error } = await supabase
      .from('sub_agents')
      .select('*')
      .eq('name', cleanName)
      .single();
    if (error) return null;
    return data;
  }
  return localAgents.get(cleanName) || null;
}

export async function deleteAgent(name) {
  const cleanName = name.trim().toLowerCase();
  if (supabase) {
    const { error } = await supabase
      .from('sub_agents')
      .delete()
      .eq('name', cleanName);
    if (error) throw new Error(error.message);
    return true;
  }
  return localAgents.delete(cleanName);
}
