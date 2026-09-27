# Environment and Deployment Rules
## Staging
In this project, **staging** means:
- The code stays in the local working tree and has not been pushed to GitHub.
- The backend must the Supabase Cloud staging project named `sat-website-staging`.
- The staging Supabase project reference is `wgkggknyndgaoyazdhdf`.
- Local frontend and worker processes must connect to that staging Supabase project for integration testing.
- Do not create or push a Git branch, trigger Cloudflare Pages, or deploy to the main Supabase project when asked to make something work in staging.
Before changing the staging database or Edge Functions, explicitly verify that the target project reference is `wgkggknyndgaoyazdhdf`.

## Production
In this project, **production** means:
- Push the intended code to GitHub.
- Deploy the frontend through Cloudflare Pages.
- Apply migrations and deploy Edge Functions to the main Supabase Cloud project named `sat-practice`.
- The production Supabase project reference is `ygqndcgpbtmewzkruyuq`.
Treat any GitHub push, Cloudflare deployment, or change to `ygqndcgpbtmewzkruyuq` as a production deployment. Do not perform a production deployment unless the user explicitly asks for production, publishing, pushing, or going live.
