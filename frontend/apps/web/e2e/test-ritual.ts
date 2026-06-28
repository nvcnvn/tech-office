import * as api from './helpers/api';
import { createTestOrg } from './helpers/auth';

async function run() {
  const owner = await createTestOrg();
  const proj = await api.createProject(owner, { name: 'Test', visibility: 'PROJECT_VISIBILITY_PUBLIC' });
  console.log('Project created:', proj.project.id);
  const rit = await api.createRitualDefinition(owner, { projectId: proj.project.id, name: 'Test Rit' });
  console.log('Ritual created:', rit.ritualDefinition.id);
}
run().catch(console.error);
