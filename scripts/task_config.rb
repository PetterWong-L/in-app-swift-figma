#!/usr/bin/env ruby
# frozen_string_literal: true

require_relative "task_config_core"
require "open3"
require "optparse"
require "rbconfig"

def resolve_executable(candidate)
  if candidate.include?(File::SEPARATOR)
    expanded = File.expand_path(candidate)
    return expanded if File.file?(expanded) && File.executable?(expanded)
    return nil
  end

  ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).each do |directory|
    path = File.join(directory, candidate)
    return path if File.file?(path) && File.executable?(path)
  end
  nil
end

def launch_editor(config_path, port:, open_browser:)
  TaskConfig.new(config_path)
  node = resolve_executable(ENV.fetch("IN_APP_FIGMA_NODE", "node"))
  raise TaskConfigError, "Node.js executable is unavailable" unless node

  version_out, _version_err, version_status = Open3.capture3(node, "--version")
  major = version_out[/\Av(\d+)/, 1]&.to_i
  unless version_status.success? && major && major >= 18
    raise TaskConfigError, "Node.js 18 or newer is required"
  end

  script_root = __dir__
  arguments = [
    node,
    File.join(script_root, "task_config_server.mjs"),
    "--config", File.expand_path(config_path),
    "--bridge", File.join(script_root, "task_config_web_bridge.rb"),
    "--editor-root", File.join(script_root, "editor"),
    "--ruby", RbConfig.ruby,
    "--port", port.to_s
  ]
  arguments << "--no-open" unless open_browser
  pid = Process.spawn(*arguments)
  _pid, status = Process.wait2(pid)
  raise TaskConfigError, "local editor exited with status #{status.exitstatus}" unless status.success?
end

options = {
  config: nil,
  project_root: nil,
  eligible: false,
  commit: nil,
  reason: nil,
  port: 0,
  open_browser: true
}

command = ARGV.shift
parser = OptionParser.new do |opts|
  opts.banner = "Usage: task_config.rb COMMAND [MODULE PAGE] [options]"
  opts.on("--config PATH", "Config path (default: ./InAppFigma/InAppFigma.yaml)") { |value| options[:config] = value }
  opts.on("--project-root PATH", "Project root for init") { |value| options[:project_root] = value }
  opts.on("--eligible", "List only todo and failed pages") { options[:eligible] = true }
  opts.on("--commit HASH", "Commit recorded by complete") { |value| options[:commit] = value }
  opts.on("--reason TEXT", "Reason for fail, block, requeue, or amend") { |value| options[:reason] = value }
  opts.on("--port PORT", Integer, "Local editor port (default: random)") { |value| options[:port] = value }
  opts.on("--no-open", "Print URL without opening a browser") { options[:open_browser] = false }
end

begin
  parser.parse!(ARGV)
  default_root = options[:project_root] || Dir.pwd
  config_path = options[:config] || File.join(
    default_root,
    TaskConfig::WORKSPACE_DIRECTORY,
    TaskConfig::CONFIG_FILENAME
  )
  template_path = File.expand_path("../assets/InAppFigma.yaml", __dir__)

  case command
  when "init"
    TaskConfig.init(
      config_path,
      template_path,
      project_root: default_root,
      fallback_script: File.expand_path(__FILE__)
    )
  when "validate"
    config = TaskConfig.new(config_path)
    counts = config.counts
    puts "Valid: #{counts[:pages]} pages, #{counts[:states]} states, #{counts[:behaviors]} behaviors"
  when "list"
    puts TaskConfig.new(config_path).list(eligible: options[:eligible])
  when "changes"
    module_id, page_id = ARGV
    raise TaskConfigError, "MODULE and PAGE are required" unless module_id && page_id

    puts YAML.dump(TaskConfig.new(config_path).page_changes(module_id, page_id))
  when "serve"
    unless options[:port].between?(0, 65_535)
      raise TaskConfigError, "port must be between 0 and 65535"
    end
    launch_editor(config_path, port: options[:port], open_browser: options[:open_browser])
  when "claim", "complete", "fail", "block", "requeue", "amend"
    module_id, page_id = ARGV
    raise TaskConfigError, "MODULE and PAGE are required" unless module_id && page_id

    config = TaskConfig.new(config_path)
    case command
    when "claim" then config.claim(module_id, page_id)
    when "complete" then config.complete(module_id, page_id, commit: options[:commit])
    when "fail" then config.fail(module_id, page_id, reason: options[:reason])
    when "block" then config.block(module_id, page_id, reason: options[:reason])
    when "requeue" then config.requeue(module_id, page_id, reason: options[:reason])
    when "amend" then config.amend(module_id, page_id, reason: options[:reason])
    end
    puts "Updated #{module_id}.#{page_id} -> #{command}"
  else
    warn parser
    exit 2
  end
rescue TaskConfigError, OptionParser::ParseError => e
  warn "error: #{e.message}"
  exit 1
end
