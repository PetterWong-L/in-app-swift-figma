# frozen_string_literal: true

require "json"
require "minitest/autorun"
require "yaml"

class ExecutionEfficiencyContractTest < Minitest::Test
  SKILL_ROOT = File.expand_path("..", __dir__)

  def test_decision_cases_are_well_formed_and_unique
    cases = JSON.parse(File.read(File.join(__dir__, "execution_efficiency_cases.json"))).fetch("cases")
    names = cases.map { |item| item.fetch("name") }

    assert_equal names.uniq, names
    assert cases.all? { |item| item.key?("situation") }
    assert cases.all? { |item| item.keys.any? { |key| key.start_with?("expected_") } }
  end

  def test_skill_routes_efficiency_work_and_references_define_each_gate
    efficiency_path = File.join(SKILL_ROOT, "references", "execution-efficiency.md")
    assert File.exist?(efficiency_path), "missing execution-efficiency.md"

    skill = File.read(File.join(SKILL_ROOT, "SKILL.md"))
    efficiency = File.read(efficiency_path)
    parallel = File.read(File.join(SKILL_ROOT, "references", "parallel-execution.md"))
    assets = File.read(File.join(SKILL_ROOT, "references", "assets-and-verification.md"))

    assert_includes skill, "execution-efficiency.md"
    assert_includes efficiency, "## Bounded Context Packet"
    assert_includes efficiency, "## Evidence Reuse"
    assert_includes efficiency, "## Pre-Review Self-Check"
    assert_includes efficiency, "## Review Scope"
    assert_includes efficiency, "## Amendment Lifecycle"
    assert_includes efficiency, "task_config.rb amend"
    assert_includes efficiency, "## Finding Gate"
    assert_includes efficiency, "## Stalled Work"
    assert_includes efficiency, "## Retry Budget"
    assert_includes parallel, "execution-efficiency.md"
    assert_includes assets, "## Asset Intake Gate"
  end

  def test_task_configuration_documents_the_local_editor_boundaries
    guide = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))

    assert_includes guide, "task_config.rb serve"
    assert_includes guide, "127.0.0.1"
    assert_includes guide, "409"
    assert_includes guide, "cannot start Codex tasks"
    assert_includes guide, "CLI remains preferred for automation"
  end


  def test_task_configuration_and_template_define_traceable_amendments
    guide = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))
    template = File.read(File.join(SKILL_ROOT, "assets", "InAppFigma.yaml"))

    assert_includes guide, "acceptance_history"
    assert_includes guide, "done -> in_progress"
    assert_includes guide, "task_config.rb amend"
    assert_match(/done -> in_progress \(amendment/, template)
    assert_includes template, "acceptance_history"
  end

  def test_incremental_task_status_guidance_is_traceable_from_entrypoint_to_template
    skill = File.read(File.join(SKILL_ROOT, "SKILL.md"))
    workflow = File.read(File.join(SKILL_ROOT, "references", "core-workflow.md"))
    guide = File.read(File.join(SKILL_ROOT, "references", "task-configuration.md"))
    efficiency = File.read(File.join(SKILL_ROOT, "references", "execution-efficiency.md"))
    template = File.read(File.join(SKILL_ROOT, "assets", "InAppFigma.yaml"))
    baseline = JSON.parse(File.read(File.join(__dir__, "incremental_task_status_cases.json")))

    evaluation = baseline.fetch("cases").first
    assert_equal "failed", evaluation.fetch("baseline_result")
    assert_equal "passed", evaluation.fetch("forward_result")
    assert_includes skill, "task_config.rb changes"
    assert_includes skill, "implementation_status"
    %w[added modified removed unchanged].each { |change| assert_includes workflow, "`#{change}`" }
    assert_includes guide, "schema v7"
    assert_includes guide, "## Schema v6 Migration"
    assert_includes guide, "## Schema v5 Migration"
    assert_includes guide, "accepted_baseline"
    assert_includes guide, "removed_tasks"
    assert_includes guide, "todo | in_progress | done"
    assert_includes guide, "confirm_amendments"
    assert_includes efficiency, "unfinished item tasks"
    assert_includes efficiency, "unchanged `done` tasks"
    assert_equal 7, YAML.safe_load(template).fetch("schema_version")
    assert_includes template, "implementation_status: todo"
    assert_includes template, "accepted_baseline:"
    assert_includes template, "removed_tasks: []"
  end
end
