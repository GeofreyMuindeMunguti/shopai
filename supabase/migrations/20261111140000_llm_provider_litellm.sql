-- Allow llm_models rows served by the LiteLLM proxy (Anthropic Messages API).
-- bedrock_model_id holds the provider-specific model ref, e.g. 'claude-sonnet-5-5'.
alter table llm_models drop constraint if exists llm_models_provider_check;
alter table llm_models add constraint llm_models_provider_check check (provider in ('bedrock', 'litellm'));
