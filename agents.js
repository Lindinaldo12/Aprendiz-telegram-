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
      // Se a tabela não existe, cai na memória local em vez de falhar
      console.warn('[createAgent] Supabase falhou, usando memória local:', error.message);
      localAgents.set(cleanName, agent);
      return agent;
    }
    return data;
  }

  localAgents.set(cleanName, agent);
  return agent;
}
