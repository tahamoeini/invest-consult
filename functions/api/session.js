import { issueSession } from "./_security.js";

export async function onRequestPost(context) {
  return issueSession(context.request, context.env);
}
