#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "optparse"
require_relative "task_config_core"

class TaskConfigWebRequestError < StandardError; end

def emit(payload, exit_status: 0)
  puts JSON.generate(payload)
  exit exit_status
end

begin
operation = ARGV.shift
options = { config: nil }
OptionParser.new do |parser|
  parser.on("--config PATH") { |value| options[:config] = value }
end.parse!(ARGV)

raise TaskConfigWebRequestError, "operation is required" if operation.nil?
raise TaskConfigWebRequestError, "unexpected arguments" unless ARGV.empty?
raise TaskConfigWebRequestError, "absolute config path is required" unless options[:config]&.start_with?(File::SEPARATOR)

payload = JSON.parse($stdin.read)
raise TaskConfigWebRequestError, "request body must be a JSON object" unless payload.is_a?(Hash)

config_path = File.expand_path(options.fetch(:config))
result = case operation
         when "snapshot"
           { "snapshot" => TaskConfig.new(config_path).snapshot }
         when "validate"
           TaskConfig.validate_draft(payload.fetch("config"), path: config_path)
         when "save"
           saved = TaskConfig.new(config_path).replace!(
             payload.fetch("config"),
             expected_revision: payload.fetch("expected_revision"),
             acknowledge_comment_loss: payload.fetch("acknowledge_comment_loss", false),
             confirm_amendments: payload.fetch("confirm_amendments", false)
           )
           if saved["amendment_required"]
             {
               "ok" => false,
               "status" => 409,
               "error" => {
                 "code" => "amendment_required",
                 "message" => "Completed page task changes require amendment confirmation.",
                 "changes_by_page" => saved.fetch("changes_by_page")
               }
             }
           else
             { "snapshot" => saved }
           end
         when "status"
           {
             "snapshot" => TaskConfig.new(config_path).apply_status!(
               action: payload.fetch("action"),
               module_id: payload.fetch("module_id"),
               page_id: payload.fetch("page_id"),
               expected_revision: payload.fetch("expected_revision"),
               reason: payload["reason"],
               commit: payload["commit"]
             )
           }
         else
           raise TaskConfigWebRequestError, "unknown web operation #{operation}"
         end

status = result["valid"] == false ? 422 : result.fetch("status", 200)
emit({ "ok" => status < 400, "status" => status }.merge(result))
rescue TaskConfigRevisionConflict => e
  emit({
    "ok" => false,
    "status" => 409,
    "error" => { "code" => "revision_conflict", "message" => e.message }
  })
rescue TaskConfigValidationError => e
  emit({
    "ok" => false,
    "status" => 422,
    "issues" => e.issues.map(&:to_h),
    "error" => { "code" => "validation_failed", "message" => e.message }
  })
rescue TaskConfigError => e
  emit({
    "ok" => false,
    "status" => 422,
    "error" => { "code" => "domain_error", "message" => e.message }
  })
rescue JSON::ParserError, KeyError, OptionParser::ParseError, TaskConfigWebRequestError => e
  emit({
    "ok" => false,
    "status" => 400,
    "error" => { "code" => "invalid_request", "message" => e.message }
  }, exit_status: 1)
rescue StandardError
  emit({
    "ok" => false,
    "status" => 500,
    "error" => { "code" => "internal_error", "message" => "Unexpected bridge failure." }
  }, exit_status: 1)
end
