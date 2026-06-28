import * as api from './helpers/api';
import { createTestOrg } from './helpers/auth';

async function run() {
  const owner = await createTestOrg();
  const proj = await api.createProject(owner, { name: 'Test', visibility: 'PROJECT_VISIBILITY_PUBLIC' });
  console.log('Project created:', proj.project.id);
  const task = await api.createTask(owner, proj.project.id, 'Test Task', { levelId: proj.levels[0]?.id });
  console.log('Task created:', task.task.id);
}
run().catch(console.error);
