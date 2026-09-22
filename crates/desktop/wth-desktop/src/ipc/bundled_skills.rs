//! E-01: 捆绑技能包种子机制。
//!
//! 把仓库 `bundled-skills/` 目录的技能在启动时种子到 `~/.wth/bundled/`
//! （已存在的不覆盖，尊重用户修改）。CLI 侧的技能发现（`wth-agent`
//! prompt/skills 的 `global_dir/bundled` 扫描）与桌面端技能页自动生效。

/// `(目录名, SKILL.md 内容)`，内容为仓库 `bundled-skills/` 的编译期内嵌。
const BUNDLED_SKILLS: &[(&str, &str)] = &[
    (
        "git-commit",
        include_str!("../../../../../bundled-skills/git-commit/SKILL.md"),
    ),
    (
        "test-gen",
        include_str!("../../../../../bundled-skills/test-gen/SKILL.md"),
    ),
    (
        "refactor",
        include_str!("../../../../../bundled-skills/refactor/SKILL.md"),
    ),
    (
        "docs-gen",
        include_str!("../../../../../bundled-skills/docs-gen/SKILL.md"),
    ),
    (
        "i18n-extract",
        include_str!("../../../../../bundled-skills/i18n-extract/SKILL.md"),
    ),
    (
        "release-notes",
        include_str!("../../../../../bundled-skills/release-notes/SKILL.md"),
    ),
    (
        "mcp-author",
        include_str!("../../../../../bundled-skills/mcp-author/SKILL.md"),
    ),
    (
        "plugin-author",
        include_str!("../../../../../bundled-skills/plugin-author/SKILL.md"),
    ),
    (
        "perf-profile",
        include_str!("../../../../../bundled-skills/perf-profile/SKILL.md"),
    ),
    (
        "dependency-audit",
        include_str!("../../../../../bundled-skills/dependency-audit/SKILL.md"),
    ),
];

/// 把内嵌技能种子到 `<home>/bundled/<name>/SKILL.md`（不覆盖既有文件）。
/// 返回新增数量。`home` 为 WTH 主目录（`~/.wth`）。
pub fn seed_bundled_skills(home: &std::path::Path) -> usize {
    let bundled = home.join("bundled");
    let mut seeded = 0;
    for (name, content) in BUNDLED_SKILLS {
        let dir = bundled.join(name);
        let target = dir.join("SKILL.md");
        if target.exists() {
            continue;
        }
        if std::fs::create_dir_all(&dir).is_err() {
            continue;
        }
        if std::fs::write(&target, content).is_ok() {
            seeded += 1;
        }
    }
    seeded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_skills_have_frontmatter_and_unique_dirs() {
        let mut seen = std::collections::HashSet::new();
        for (name, content) in BUNDLED_SKILLS {
            assert!(seen.insert(*name), "重复技能目录: {name}");
            assert!(content.starts_with("---\n"), "{name} 缺少 frontmatter");
            assert!(
                content.contains("name:") && content.contains("description:"),
                "{name} frontmatter 缺少 name/description"
            );
        }
        assert!(BUNDLED_SKILLS.len() >= 10, "至少 10 个捆绑技能");
    }

    #[test]
    fn seed_writes_missing_only() {
        let tmp = std::env::temp_dir().join(format!("wth-seed-{}", std::process::id()));
        let home = tmp.join(".wth");
        let first = seed_bundled_skills(&home);
        assert_eq!(first, BUNDLED_SKILLS.len(), "首次应写入全部技能");
        assert!(home.join("bundled/git-commit/SKILL.md").exists());
        // 用户修改不覆盖
        let target = home.join("bundled/refactor/SKILL.md");
        std::fs::write(&target, "user edit").unwrap();
        let second = seed_bundled_skills(&home);
        assert_eq!(second, 0, "已存在的不覆盖");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "user edit");
        std::fs::remove_dir_all(&tmp).ok();
    }
}
