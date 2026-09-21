import { createClient } from '@supabase/supabase-js';

// Conexão opcional com Supabase. Se não configurado, usa memória local.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

// Fallback em memória quando Supabase não está configurado
const localAgents = new Map();

// Cria as tabelas automaticamente se não existirem
export async function initAgents() {
  if (!supabase) return;
  const { error } = await supabase.rpc('create_sub_agents_table');
  if (error) console.error('[initAgents]', error.message);
}

// Cria um novo sub-agente
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
    if (error) throw new Error(error.message);
    return data;
  }

  localAgents.set(cleanName, agent);
  return agent;
}

// Lista todos os sub-agentes
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

// Busca um agente específico
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

// Deleta um sub-agente
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
